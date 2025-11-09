'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Zap,
  Sliders,
  Database,
  Edit,
  X,
  Check,
  Download,
  ChevronUp,
  ChevronDown,
  Brain,
  Clock,
  CreditCard,
  Cpu
} from 'lucide-react';

interface SystemSetting {
  id: string;
  key: string;
  value: any;
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface ModelPricing {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
}

export default function SystemConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([]);

  // Routing configuration state
  const [routingEnabled, setRoutingEnabled] = useState(false);
  const [lowThreshold, setLowThreshold] = useState(3.9);
  const [mediumThreshold, setMediumThreshold] = useState(6.9);
  const [minSuccessRate, setMinSuccessRate] = useState(85);
  const [anthropicEnabled, setAnthropicEnabled] = useState(true);

  // Model routing configuration state (Phase 3)
  const [modelRoutingConfig, setModelRoutingConfig] = useState({
    low: { model: 'gpt-4o-mini', provider: 'openai' as 'openai' | 'anthropic' },
    medium: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' as 'openai' | 'anthropic' },
    high: { model: 'gpt-4o', provider: 'openai' as 'openai' | 'anthropic' }
  });
  const [savingModelRouting, setSavingModelRouting] = useState(false);

  // Pricing editing state
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editedInputCost, setEditedInputCost] = useState<number>(0);
  const [editedOutputCost, setEditedOutputCost] = useState<number>(0);

  // Collapse state for sections (all collapsed by default)
  const [routingExpanded, setRoutingExpanded] = useState(false);
  const [pricingExpanded, setPricingExpanded] = useState(false);
  const [calcExpanded, setCalcExpanded] = useState(false);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [pilotExpanded, setPilotExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [billingExpanded, setBillingExpanded] = useState(false);

  // Billing configuration state (loaded from database)
  const [billingConfig, setBillingConfig] = useState({
    paymentGracePeriodDays: 3
  });

  // Boost pack management state
  interface BoostPack {
    id?: string;
    pack_key: string;
    pack_name: string;
    display_name: string;
    description: string;
    price_usd: number;
    bonus_percentage: number;
    credits_amount: number;
    bonus_credits: number;
    badge_text: string | null;
    is_active: boolean;
  }

  const [boostPacks, setBoostPacks] = useState<BoostPack[]>([]);
  const [editingBoostPack, setEditingBoostPack] = useState<string | null>(null);
  const [deletingBoostPack, setDeletingBoostPack] = useState<string | null>(null);
  const [newBoostPack, setNewBoostPack] = useState<BoostPack>({
    pack_key: '',
    pack_name: '',
    display_name: '',
    description: '',
    price_usd: 10,
    bonus_percentage: 0,
    credits_amount: 0,
    bonus_credits: 0,
    badge_text: null,
    is_active: true
  });
  const [showAddBoostPack, setShowAddBoostPack] = useState(false);
  const [pilotCreditCostUsd, setPilotCreditCostUsd] = useState(0.00048);

  // Calculator configuration state (loaded from database)
  const [calcConfig, setCalcConfig] = useState({
    // Token estimation
    baseTokens: 0,
    tokensPerPlugin: 0,
    peakMultiplier: 0,
    pluginUsageRate: 0,
    orchestrationOverheadMs: 0,
    estimatedDurationMs: 0,
    estimatedFailureRate: 0,
    estimatedRetryRate: 0,
    ioRatio: 0,
    // Execution parameters
    baseIterations: 0,
    maxIterations: 0,
    // Pricing parameters
    runsPerAgentPerMonth: 0,
    agentCreationCost: 0,
    creditCostUsd: 0,
    minimumMonthlyCostUsd: 0,
    baseCreditsPerRun: 0,
    pluginOverheadPerRun: 0,
    systemOverheadPerRun: 0,
    executionStepMultiplier: 0,
    freeTierCredits: 0
  });

  // Memory configuration state (loaded from database)
  const [memoryConfig, setMemoryConfig] = useState({
    summarization: {
      model: '',
      temperature: 0,
      max_tokens: 0,
      async: false
    },
    embedding: {
      model: '',
      batch_size: 0,
      dimensions: 0
    },
    injection: {
      max_tokens: 0,
      min_recent_runs: 0,
      max_recent_runs: 0,
      semantic_search_limit: 0,
      semantic_threshold: 0
    },
    importance: {
      base_score: 0,
      error_bonus: 0,
      pattern_bonus: 0,
      user_feedback_bonus: 0,
      first_run_bonus: 0,
      milestone_bonus: 0
    },
    retention: {
      run_memories_days: 0,
      low_importance_days: 0,
      consolidation_threshold: 0,
      consolidation_frequency_days: 0
    }
  });

  // Pilot configuration state (loaded from database)
  const [pilotConfig, setPilotConfig] = useState({
    enabled: false,
    maxSteps: 50,
    maxExecutionTimeMs: 300000,
    maxParallelSteps: 3,
    retryEnabled: true,
    defaultRetryCount: 3,
    circuitBreakerThreshold: 5,
    checkpointEnabled: true,
    retentionDays: 90,
    // AgentKit Token Protection
    maxToolResponseChars: 8000,
    loopDetectionWindow: 3,
    maxSameToolRepeats: 3,
    maxTokensPerIteration: 50000,
    maxTotalExecutionTokens: 200000,
    // Per-Step Intelligent Routing
    perStepRoutingEnabled: false,
    routingStrategy: 'balanced' // conservative, balanced, aggressive
  });

  // Workflow Orchestrator configuration state (loaded from database)
  const [orchestratorConfig, setOrchestratorConfig] = useState({
    primaryModel: 'gpt-4o-mini', // 'gpt-4o-mini' | 'claude-sonnet-4'
    fallbackModel: 'claude-sonnet-4', // 'gpt-4o-mini' | 'claude-sonnet-4'
    enableFallback: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      // Fetch system settings
      const settingsResponse = await fetch('/api/admin/system-config', {
        method: 'GET',
        cache: 'no-store'
      });

      console.log('[SystemConfig] API response status:', settingsResponse.status);

      if (!settingsResponse.ok) {
        const errorText = await settingsResponse.text();
        console.error('[SystemConfig] API error response:', errorText);
        throw new Error(`Failed to fetch system settings: ${settingsResponse.status} ${errorText}`);
      }

      const settingsResult = await settingsResponse.json();
      console.log('[SystemConfig] Settings result:', settingsResult);

      if (!settingsResult.success) {
        throw new Error(settingsResult.error || 'API returned unsuccessful response');
      }

      // Parse routing settings
      const routingSettings = settingsResult.data.filter((s: SystemSetting) => s.category === 'routing');
      routingSettings.forEach((setting: SystemSetting) => {
        switch (setting.key) {
          case 'intelligent_routing_enabled':
            setRoutingEnabled(setting.value === true || setting.value === 'true');
            break;
          case 'routing_low_threshold':
            setLowThreshold(parseFloat(setting.value));
            break;
          case 'routing_medium_threshold':
            setMediumThreshold(parseFloat(setting.value));
            break;
          case 'routing_min_success_rate':
            setMinSuccessRate(parseInt(setting.value));
            break;
          case 'anthropic_provider_enabled':
            setAnthropicEnabled(setting.value === true || setting.value === 'true');
            break;
        }
      });

      // Parse pilot settings
      const pilotSettings = settingsResult.data.filter((s: SystemSetting) =>
        s.category === 'pilot' || s.category === 'agentkit_protection'
      );
      const newPilotConfig = { ...pilotConfig };
      pilotSettings.forEach((setting: SystemSetting) => {
        switch (setting.key) {
          case 'pilot_enabled':
            newPilotConfig.enabled = setting.value === true || setting.value === 'true';
            break;
          case 'pilot_max_steps':
            newPilotConfig.maxSteps = parseInt(setting.value);
            break;
          case 'pilot_max_execution_time_ms':
            newPilotConfig.maxExecutionTimeMs = parseInt(setting.value);
            break;
          case 'pilot_max_parallel_steps':
            newPilotConfig.maxParallelSteps = parseInt(setting.value);
            break;
          case 'pilot_retry_enabled':
            newPilotConfig.retryEnabled = setting.value === true || setting.value === 'true';
            break;
          case 'pilot_default_retry_count':
            newPilotConfig.defaultRetryCount = parseInt(setting.value);
            break;
          case 'pilot_circuit_breaker_threshold':
            newPilotConfig.circuitBreakerThreshold = parseInt(setting.value);
            break;
          case 'pilot_checkpoint_enabled':
            newPilotConfig.checkpointEnabled = setting.value === true || setting.value === 'true';
            break;
          case 'pilot_retention_days':
            newPilotConfig.retentionDays = parseInt(setting.value);
            break;
          // AgentKit Token Protection
          case 'max_tool_response_chars':
            newPilotConfig.maxToolResponseChars = parseInt(setting.value);
            break;
          case 'loop_detection_window':
            newPilotConfig.loopDetectionWindow = parseInt(setting.value);
            break;
          case 'max_same_tool_repeats':
            newPilotConfig.maxSameToolRepeats = parseInt(setting.value);
            break;
          case 'max_tokens_per_iteration':
            newPilotConfig.maxTokensPerIteration = parseInt(setting.value);
            break;
          case 'max_total_execution_tokens':
            newPilotConfig.maxTotalExecutionTokens = parseInt(setting.value);
            break;
          // Per-Step Intelligent Routing
          case 'pilot_per_step_routing_enabled':
            newPilotConfig.perStepRoutingEnabled = setting.value === true || setting.value === 'true';
            break;
          case 'pilot_routing_default_strategy':
            newPilotConfig.routingStrategy = setting.value?.replace(/"/g, '') || 'balanced';
            break;
        }
      });
      setPilotConfig(newPilotConfig);

      // Parse orchestrator settings
      const orchestratorSettings = settingsResult.data.filter((s: SystemSetting) =>
        s.category === 'orchestrator' || s.key.startsWith('orchestrator_')
      );
      const newOrchestratorConfig = { ...orchestratorConfig };
      orchestratorSettings.forEach((setting: SystemSetting) => {
        switch (setting.key) {
          case 'orchestrator_primary_model':
            newOrchestratorConfig.primaryModel = setting.value?.replace(/"/g, '') || 'gpt-4o-mini';
            break;
          case 'orchestrator_fallback_model':
            newOrchestratorConfig.fallbackModel = setting.value?.replace(/"/g, '') || 'claude-sonnet-4';
            break;
          case 'orchestrator_enable_fallback':
            newOrchestratorConfig.enableFallback = setting.value === true || setting.value === 'true';
            break;
        }
      });
      setOrchestratorConfig(newOrchestratorConfig);

      // Parse billing settings
      const billingSettings = settingsResult.data.filter((s: SystemSetting) => s.category === 'billing');
      billingSettings.forEach((setting: SystemSetting) => {
        if (setting.key === 'payment_grace_period_days') {
          setBillingConfig({ paymentGracePeriodDays: parseInt(setting.value as string) || 3 });
        }
        if (setting.key === 'pilot_credit_cost_usd') {
          setPilotCreditCostUsd(parseFloat(setting.value as string) || 0.00048);
        }
      });

      // Fetch boost packs
      try {
        const boostPacksResponse = await fetch('/api/admin/boost-packs', {
          method: 'GET',
          cache: 'no-store'
        });

        if (boostPacksResponse.ok) {
          const boostPacksResult = await boostPacksResponse.json();
          if (boostPacksResult.success) {
            setBoostPacks(boostPacksResult.data);
          }
        }
      } catch (boostPacksError) {
        console.error('Failed to fetch boost packs:', boostPacksError);
      }

      // Fetch AI model pricing
      try {
        const pricingResponse = await fetch('/api/admin/system-config/pricing', {
          method: 'GET',
          cache: 'no-store'
        });

        if (!pricingResponse.ok) {
          console.error('Pricing API error:', pricingResponse.status, pricingResponse.statusText);
          const errorText = await pricingResponse.text();
          console.error('Pricing API response:', errorText);
        } else {
          const pricingResult = await pricingResponse.json();
          console.log('Pricing API result:', pricingResult);

          if (pricingResult.success) {
            setPricingModels(pricingResult.data);
            console.log('Loaded pricing models:', pricingResult.data.length);
          } else {
            console.error('Pricing API returned unsuccessful:', pricingResult.error);
          }
        }
      } catch (pricingError) {
        console.error('Failed to fetch pricing:', pricingError);
        // Don't fail the entire page if pricing fails - it's supplementary data
      }

      // Fetch calculator configuration
      try {
        const calcResponse = await fetch('/api/pricing/config', {
          method: 'GET',
          cache: 'no-store'
        });

        if (calcResponse.ok) {
          const calcResult = await calcResponse.json();
          console.log('Calculator config result:', calcResult);

          if (calcResult.success && calcResult.config) {
            const c = calcResult.config;
            setCalcConfig({
              // Token estimation
              baseTokens: c.calculatorEstimation?.baseTokens ?? 0,
              tokensPerPlugin: c.calculatorEstimation?.tokensPerPlugin ?? 0,
              peakMultiplier: c.calculatorEstimation?.peakMultiplier ?? 0,
              pluginUsageRate: c.calculatorEstimation?.pluginUsageRate ?? 0,
              orchestrationOverheadMs: c.calculatorEstimation?.orchestrationOverheadMs ?? 0,
              estimatedDurationMs: c.calculatorEstimation?.estimatedDurationMs ?? 0,
              estimatedFailureRate: c.calculatorEstimation?.estimatedFailureRate ?? 0,
              estimatedRetryRate: c.calculatorEstimation?.estimatedRetryRate ?? 0,
              ioRatio: c.calculatorEstimation?.ioRatio ?? 0,
              // Execution parameters
              baseIterations: c.calculatorEstimation?.baseIterations ?? 0,
              maxIterations: c.calculatorEstimation?.maxIterations ?? 0,
              // Pricing parameters
              runsPerAgentPerMonth: c.runsPerAgentPerMonth ?? 0,
              agentCreationCost: c.agentCreationCost ?? 0,
              creditCostUsd: c.creditCostUsd ?? 0,
              minimumMonthlyCostUsd: c.minimumMonthlyCostUsd ?? 0,
              baseCreditsPerRun: c.baseCreditsPerRun ?? 0,
              pluginOverheadPerRun: c.pluginOverheadPerRun ?? 0,
              systemOverheadPerRun: c.systemOverheadPerRun ?? 0,
              executionStepMultiplier: c.executionStepMultiplier ?? 0,
              freeTierCredits: c.freeTierCredits ?? 0
            });
            console.log('Loaded calculator config:', calcResult.config);
          }
        }
      } catch (calcError) {
        console.error('Failed to fetch calculator config:', calcError);
      }

      // Fetch memory configuration
      try {
        const memoryResponse = await fetch('/api/admin/memory-config', {
          method: 'GET',
          cache: 'no-store'
        });

        if (memoryResponse.ok) {
          const memoryResult = await memoryResponse.json();
          console.log('[SystemConfig] Memory config API response:', memoryResult);

          if (memoryResult.success && memoryResult.configs) {
            console.log('[SystemConfig] Setting memory config state:', memoryResult.configs);
            setMemoryConfig(memoryResult.configs);
            console.log('[SystemConfig] ✅ Memory config loaded successfully');
          } else {
            console.error('[SystemConfig] ❌ Memory config API returned unsuccessful or missing configs');
          }
        } else {
          console.error('[SystemConfig] ❌ Memory config API returned non-OK status:', memoryResponse.status);
        }
      } catch (memoryError) {
        console.error('[SystemConfig] ❌ Failed to fetch memory config:', memoryError);
      }

      // Fetch model routing configuration (Phase 3)
      try {
        const modelRoutingResponse = await fetch('/api/admin/model-routing', {
          method: 'GET',
          cache: 'no-store'
        });

        if (modelRoutingResponse.ok) {
          const modelRoutingResult = await modelRoutingResponse.json();
          console.log('[SystemConfig] Model routing result:', modelRoutingResult);

          if (modelRoutingResult.success && modelRoutingResult.config) {
            setModelRoutingConfig(modelRoutingResult.config);
            console.log('[SystemConfig] ✅ Model routing config loaded successfully');
          } else {
            console.error('[SystemConfig] ❌ Model routing API returned unsuccessful');
          }
        } else {
          console.error('[SystemConfig] ❌ Model routing API returned non-OK status:', modelRoutingResponse.status);
        }
      } catch (modelRoutingError) {
        console.error('[SystemConfig] ❌ Failed to fetch model routing config:', modelRoutingError);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleSaveRoutingConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const updates = {
        intelligent_routing_enabled: routingEnabled,
        routing_low_threshold: lowThreshold,
        routing_medium_threshold: mediumThreshold,
        routing_min_success_rate: minSuccessRate,
        anthropic_provider_enabled: anthropicEnabled
      };

      const response = await fetch('/api/admin/system-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates })
      });

      if (!response.ok) {
        throw new Error('Failed to update system configuration');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update configuration');
      }

      setSuccess('Configuration saved successfully!');

      // Note: Don't refresh data after save - local state already has updated values

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving configuration:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModelRoutingConfig = async () => {
    try {
      setSavingModelRouting(true);
      setError(null);
      setSuccess(null);

      console.log('[SystemConfig] Saving model routing config:', modelRoutingConfig);

      const response = await fetch('/api/admin/model-routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: modelRoutingConfig })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to save model routing config: ${response.status}`);
      }

      setSuccess('✅ Model routing configuration saved successfully!');
      console.log('[SystemConfig] ✅ Model routing config saved');

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('[SystemConfig] Error saving model routing config:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSavingModelRouting(false);
    }
  };

  const handleSavePilotConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      // Save with new pilot keys (system will handle backward compatibility)
      const updates = {
        pilot_enabled: pilotConfig.enabled,
        pilot_max_steps: pilotConfig.maxSteps,
        pilot_max_execution_time_ms: pilotConfig.maxExecutionTimeMs,
        pilot_max_parallel_steps: pilotConfig.maxParallelSteps,
        pilot_retry_enabled: pilotConfig.retryEnabled,
        pilot_default_retry_count: pilotConfig.defaultRetryCount,
        pilot_circuit_breaker_threshold: pilotConfig.circuitBreakerThreshold,
        pilot_checkpoint_enabled: pilotConfig.checkpointEnabled,
        pilot_retention_days: pilotConfig.retentionDays,
        // AgentKit Token Protection
        max_tool_response_chars: pilotConfig.maxToolResponseChars,
        loop_detection_window: pilotConfig.loopDetectionWindow,
        max_same_tool_repeats: pilotConfig.maxSameToolRepeats,
        max_tokens_per_iteration: pilotConfig.maxTokensPerIteration,
        max_total_execution_tokens: pilotConfig.maxTotalExecutionTokens,
        // Per-Step Intelligent Routing
        pilot_per_step_routing_enabled: pilotConfig.perStepRoutingEnabled,
        pilot_routing_default_strategy: pilotConfig.routingStrategy,
        // Workflow Orchestrator
        orchestrator_primary_model: orchestratorConfig.primaryModel,
        orchestrator_fallback_model: orchestratorConfig.fallbackModel,
        orchestrator_enable_fallback: orchestratorConfig.enableFallback
      };

      const response = await fetch('/api/admin/system-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates })
      });

      if (!response.ok) {
        throw new Error('Failed to update pilot configuration');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update pilot configuration');
      }

      setSuccess('Pilot and Orchestrator configuration saved successfully!');

      // Scroll to top to show success message
      window.scrollTo({ top: 0, behavior: 'smooth' });

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving pilot configuration:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      // Scroll to top to show error message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const handleEditPricing = (model: ModelPricing) => {
    setEditingPricing(model.id);
    setEditedInputCost(model.input_cost_per_token);
    setEditedOutputCost(model.output_cost_per_token);
  };

  const handleCancelEditPricing = () => {
    setEditingPricing(null);
    setEditedInputCost(0);
    setEditedOutputCost(0);
  };

  const handleSavePricing = async (modelId: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: modelId,
          input_cost_per_token: editedInputCost,
          output_cost_per_token: editedOutputCost
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update pricing');
      }

      setSuccess('Pricing updated successfully!');
      setEditingPricing(null);

      // Note: Don't refresh data after save - local state already has updated values

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error updating pricing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncPricing = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing/sync', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to sync pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sync pricing');
      }

      setSuccess(result.message || 'Pricing synced successfully!');

      // Refresh pricing data after sync since it fetches from external API
      await fetchData(true);

      setTimeout(() => setSuccess(null), 5000);

    } catch (error) {
      console.error('Error syncing pricing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCalculatorConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/calculator-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: calcConfig })
      });

      if (!response.ok) {
        throw new Error('Failed to update calculator configuration');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to update calculator configuration');
      }

      setSuccess('Calculator configuration saved successfully!');

      // Note: Don't refresh data after save because:
      // 1. Local state already has the updated values
      // 2. Database view (calculator_config) may have caching delays
      // 3. Refreshing would overwrite user's changes with potentially stale view data

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error saving calculator config:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMemoryConfig = async (configKey: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const configValue = (memoryConfig as any)[configKey];
      console.log(`[SystemConfig] 💾 Saving memory config: ${configKey}`, configValue);

      const response = await fetch('/api/admin/memory-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          configKey,
          configValue
        })
      });

      console.log(`[SystemConfig] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SystemConfig] ❌ API error:`, errorText);
        throw new Error(`Failed to update ${configKey} configuration: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[SystemConfig] API result:`, result);

      if (!result.success) {
        throw new Error(result.error || `Failed to update ${configKey} configuration`);
      }

      const successMessage = `Memory ${configKey} configuration saved successfully!`;
      console.log(`[SystemConfig] ✅ ${successMessage}`);
      setSuccess(successMessage);

      // Note: Don't refresh data after save - local state already has updated values
      // and database may have caching delays

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('[SystemConfig] ❌ Error saving memory config:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBillingConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const updates = {
        payment_grace_period_days: billingConfig.paymentGracePeriodDays
      };

      const response = await fetch('/api/admin/system-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates })
      });

      if (!response.ok) {
        throw new Error('Failed to update billing configuration');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update billing configuration');
      }

      setSuccess('Billing configuration saved successfully!');

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving billing configuration:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Boost pack management functions
  const calculateBoostPackCredits = (price_usd: number, bonus_percentage: number) => {
    const baseCredits = Math.round(price_usd / pilotCreditCostUsd);
    const bonusCredits = Math.round(baseCredits * (bonus_percentage / 100));
    return { baseCredits, bonusCredits };
  };

  const handleSaveBoostPack = async (pack: BoostPack) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      // Calculate credits before saving
      const { baseCredits, bonusCredits } = calculateBoostPackCredits(pack.price_usd, pack.bonus_percentage);

      const packToSave = {
        ...pack,
        credits_amount: baseCredits,
        bonus_credits: bonusCredits
      };

      const response = await fetch('/api/admin/boost-packs', {
        method: pack.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packToSave)
      });

      if (!response.ok) {
        throw new Error('Failed to save boost pack');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save boost pack');
      }

      setSuccess(`Boost pack "${pack.pack_name}" saved successfully!`);
      setEditingBoostPack(null);
      setShowAddBoostPack(false);

      // Refresh boost packs
      await fetchData(true);

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving boost pack:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBoostPack = async (packId: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/boost-packs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: packId })
      });

      if (!response.ok) {
        throw new Error('Failed to delete boost pack');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete boost pack');
      }

      setSuccess('Boost pack deleted successfully!');
      setDeletingBoostPack(null);

      // Refresh boost packs
      await fetchData(true);

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error deleting boost pack:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 8,
      maximumFractionDigits: 8
    }).format(cost);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Settings className="w-8 h-8 text-blue-400" />
            System Configuration
          </h1>
          <p className="text-slate-400">Manage system-wide settings and AI model routing</p>
        </div>

        <button
          onClick={() => fetchData()}
          disabled={loading}
          className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <CheckCircle className="w-5 h-5 text-green-400" />
          <p className="text-green-400">{success}</p>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </motion.div>
      )}

      {/* Intelligent Routing Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                Intelligent Model Routing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Route agents to cost-efficient AI models based on complexity scores. Reduces costs by up to 94%.
              </p>
            </div>
            <button
              onClick={() => setRoutingExpanded(!routingExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {routingExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {routingExpanded && (
          <div className="p-6 space-y-6">
          {/* Info Box */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-3">
                <p className="text-yellow-400 font-medium text-sm">How Intelligent Routing Works</p>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Intelligent Routing automatically selects the most cost-effective AI model based on each agent's AIS (Agent Intensity Score). The system analyzes complexity across 5 dimensions and routes to tiered models, achieving up to 94% cost savings without sacrificing quality.
                </p>
                <div className="space-y-2 text-xs leading-relaxed">
                  <p className="text-slate-300">
                    <strong className="text-yellow-300">Low Complexity (Score ≤ threshold):</strong> Routes to budget models like GPT-4o-mini or GPT-3.5-turbo. Ideal for simple queries, data retrieval, and straightforward workflows. Cost savings: 94% vs GPT-4o.
                  </p>
                  <p className="text-slate-300">
                    <strong className="text-yellow-300">Medium Complexity (Between thresholds):</strong> Routes to mid-tier models like Claude Haiku or GPT-4o-mini. Handles moderate reasoning, multi-step workflows, moderate plugin usage. Cost savings: 88% vs GPT-4o.
                  </p>
                  <p className="text-slate-300">
                    <strong className="text-yellow-300">High Complexity (Score {'>'} threshold):</strong> Routes to premium models like GPT-4o or Claude Sonnet. Reserved for complex reasoning, heavy plugin orchestration, large context windows. Maximum reliability.
                  </p>
                  <p className="text-slate-300">
                    <strong className="text-yellow-300">New Agent Handling:</strong> Agents start on budget models until minimum execution count is reached. System then routes based on actual performance metrics from real executions.
                  </p>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mt-2">
                  <p className="text-yellow-300 text-xs font-medium mb-1">Cost Impact</p>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    Typical deployment: <strong className="text-white">70% low complexity</strong> (GPT-4o-mini), <strong className="text-white">20% medium</strong> (Claude Haiku), <strong className="text-white">10% high</strong> (GPT-4o).
                    Average cost reduction: <strong className="text-green-400">60-80%</strong> compared to using GPT-4o for all agents.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Master Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium text-white">Enable Intelligent Routing</h3>
                {routingEnabled ? (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Active</span>
                ) : (
                  <span className="px-2 py-0.5 bg-slate-600/50 text-slate-400 text-xs rounded-full">Disabled</span>
                )}
              </div>
              <p className="text-sm text-slate-400">
                When enabled, the system will automatically select the most cost-effective AI model based on agent complexity scores
              </p>
            </div>
            <button
              onClick={() => setRoutingEnabled(!routingEnabled)}
              className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                routingEnabled ? 'bg-green-500' : 'bg-slate-600'
              }`}
            >
              <motion.div
                className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                animate={{ x: routingEnabled ? 32 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </div>

          {/* Routing Thresholds */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Low Complexity Threshold
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={lowThreshold}
                  onChange={(e) => setLowThreshold(parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  max="10"
                  className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-slate-400 text-sm">≤ {lowThreshold}</span>
              </div>
              <p className="text-xs text-slate-500">Agents scoring below this use the cheapest model (GPT-4o-mini). Higher = more agents use cheap model.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Medium Complexity Threshold
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={mediumThreshold}
                  onChange={(e) => setMediumThreshold(parseFloat(e.target.value))}
                  step="0.1"
                  min="0"
                  max="10"
                  className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-slate-400 text-sm">≤ {mediumThreshold}</span>
              </div>
              <p className="text-xs text-slate-500">Agents scoring below this use mid-tier model (Claude Haiku). Scores above use premium GPT-4o.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Minimum Success Rate (%)
              </label>
              <input
                type="number"
                value={minSuccessRate}
                onChange={(e) => setMinSuccessRate(parseInt(e.target.value))}
                min="0"
                max="100"
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-slate-500">Failing agents (below this %) automatically upgrade to premium model for better reliability.</p>
            </div>
          </div>

          {/* Anthropic Provider Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium text-white mb-1">Enable Anthropic Claude</h3>
              <p className="text-sm text-slate-400">
                Use Claude 3 Haiku for medium complexity tasks (88% savings vs GPT-4o)
              </p>
            </div>
            <button
              onClick={() => setAnthropicEnabled(!anthropicEnabled)}
              className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                anthropicEnabled ? 'bg-green-500' : 'bg-slate-600'
              }`}
            >
              <motion.div
                className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                animate={{ x: anthropicEnabled ? 32 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </div>

          {/* Model Configuration (Phase 3 - Database-Driven) */}
          <div className="bg-slate-700/30 rounded-lg p-4">
            <h3 className="font-medium text-white mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-purple-400" />
              Model Configuration (Phase 3)
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              Configure which AI models are used for each complexity tier. Changes take effect immediately for new agent executions.
            </p>

            <div className="space-y-4">
              {/* Low Complexity Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-green-300">
                  Low Complexity Model (0-{lowThreshold})
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Model Name</label>
                    <input
                      type="text"
                      value={modelRoutingConfig.low.model}
                      onChange={(e) => setModelRoutingConfig({
                        ...modelRoutingConfig,
                        low: { ...modelRoutingConfig.low, model: e.target.value }
                      })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                      placeholder="e.g., gpt-4o-mini"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Provider</label>
                    <select
                      value={modelRoutingConfig.low.provider}
                      onChange={(e) => setModelRoutingConfig({
                        ...modelRoutingConfig,
                        low: { ...modelRoutingConfig.low, provider: e.target.value as 'openai' | 'anthropic' }
                      })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Cost-optimized model for simple agents with low complexity scores</p>
              </div>

              {/* Medium Complexity Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-blue-300">
                  Medium Complexity Model ({lowThreshold + 0.1}-{mediumThreshold})
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Model Name</label>
                    <input
                      type="text"
                      value={modelRoutingConfig.medium.model}
                      onChange={(e) => setModelRoutingConfig({
                        ...modelRoutingConfig,
                        medium: { ...modelRoutingConfig.medium, model: e.target.value }
                      })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g., claude-3-5-haiku-20241022"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Provider</label>
                    <select
                      value={modelRoutingConfig.medium.provider}
                      onChange={(e) => setModelRoutingConfig({
                        ...modelRoutingConfig,
                        medium: { ...modelRoutingConfig.medium, provider: e.target.value as 'openai' | 'anthropic' }
                      })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Balanced model for moderate complexity agents with decent cost/quality ratio</p>
              </div>

              {/* High Complexity Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-300">
                  High Complexity Model ({mediumThreshold + 0.1}-10.0)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Model Name</label>
                    <input
                      type="text"
                      value={modelRoutingConfig.high.model}
                      onChange={(e) => setModelRoutingConfig({
                        ...modelRoutingConfig,
                        high: { ...modelRoutingConfig.high, model: e.target.value }
                      })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                      placeholder="e.g., gpt-4o"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Provider</label>
                    <select
                      value={modelRoutingConfig.high.provider}
                      onChange={(e) => setModelRoutingConfig({
                        ...modelRoutingConfig,
                        high: { ...modelRoutingConfig.high, provider: e.target.value as 'openai' | 'anthropic' }
                      })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Premium model for complex agents requiring maximum capability</p>
              </div>

              {/* Save Model Config Button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveModelRoutingConfig}
                  disabled={savingModelRouting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {savingModelRouting ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Saving Models...
                    </>
                  ) : (
                    <>
                      <Save className="w-3 h-3" />
                      Save Model Configuration
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Routing Tier Visualization */}
          <div className="bg-slate-700/30 rounded-lg p-4">
            <h3 className="font-medium text-white mb-4 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-400" />
              Routing Strategy (Current Config)
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-32 text-sm text-slate-300">Low (0-{lowThreshold})</div>
                <div className="flex-1 h-8 bg-green-500/20 border border-green-500/50 rounded-lg flex items-center px-3">
                  <span className="text-sm text-green-400 font-medium">{modelRoutingConfig.low.model}</span>
                  <span className="ml-2 text-xs text-green-300">({modelRoutingConfig.low.provider})</span>
                  <span className="ml-auto text-xs text-green-400">Cost-optimized</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 text-sm text-slate-300">Medium ({lowThreshold + 0.1}-{mediumThreshold})</div>
                <div className="flex-1 h-8 bg-blue-500/20 border border-blue-500/50 rounded-lg flex items-center px-3">
                  <span className="text-sm text-blue-400 font-medium">{modelRoutingConfig.medium.model}</span>
                  <span className="ml-2 text-xs text-blue-300">({modelRoutingConfig.medium.provider})</span>
                  <span className="ml-auto text-xs text-blue-400">Balanced</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 text-sm text-slate-300">High ({mediumThreshold + 0.1}-10.0)</div>
                <div className="flex-1 h-8 bg-purple-500/20 border border-purple-500/50 rounded-lg flex items-center px-3">
                  <span className="text-sm text-purple-400 font-medium">{modelRoutingConfig.high.model}</span>
                  <span className="ml-2 text-xs text-purple-300">({modelRoutingConfig.high.provider})</span>
                  <span className="ml-auto text-xs text-purple-400">Premium</span>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-white/10">
            <button
              onClick={handleSaveRoutingConfig}
              disabled={saving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </div>
        )}
      </motion.div>

      {/* AI Model Pricing Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                AI Model Pricing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Token costs for all AI models. Sync to get latest pricing from providers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncPricing}
                disabled={saving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Sync Latest Pricing
                  </>
                )}
              </button>
              <button
                onClick={() => setPricingExpanded(!pricingExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {pricingExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        </div>

        {pricingExpanded && (
          <div className="p-6 space-y-4">
            {/* Info Box */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-green-400 font-medium text-sm">About Model Pricing</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    This table defines the cost per token for each AI model's input (prompts) and output (responses). These prices directly impact cost calculations, billing, and intelligent routing decisions. Accurate pricing ensures reliable cost estimates and optimal model selection.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-green-300">Input Cost:</strong> Price per 1,000 input tokens (prompts, context, memory). Measured in USD. Example: $0.00015 = 15 cents per 1M tokens.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Output Cost:</strong> Price per 1,000 output tokens (AI responses, generated content). Typically 2-3x higher than input. Example: $0.0006 = 60 cents per 1M tokens.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Sync Latest Pricing:</strong> Automatically fetches current rates from OpenAI and Anthropic APIs. Keeps system aligned with provider pricing changes. Run monthly or when providers announce updates.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Manual Edits:</strong> Override prices for custom contracts, volume discounts, or testing. Changes affect cost calculations immediately but don't alter provider billing.
                    </p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-2">
                    <p className="text-green-300 text-xs font-medium mb-1">Impact on Intelligent Routing</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      Lower model costs increase routing priority. If GPT-4o-mini price drops, more agents route there. If Claude Haiku becomes cheaper than GPT-4o-mini, <strong className="text-white">medium complexity agents automatically switch</strong> to maximize savings.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/30">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Model
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Input Cost/Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Output Cost/Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Effective Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pricingModels.map((model) => {
                const isEditing = editingPricing === model.id;

                return (
                  <tr key={model.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full capitalize">
                        {model.provider}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-mono">
                      {model.model_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={editedInputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedInputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedInputCost(editedInputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedInputCost(Math.max(0, editedInputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono">{formatCost(model.input_cost_per_token)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={editedOutputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedOutputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedOutputCost(editedOutputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedOutputCost(Math.max(0, editedOutputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono">{formatCost(model.output_cost_per_token)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 text-right">
                      {new Date(model.effective_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSavePricing(model.id)}
                            disabled={saving}
                            className="p-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded transition-colors"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEditPricing}
                            disabled={saving}
                            className="p-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-700 text-white rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditPricing(model)}
                          className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          title="Edit pricing"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        )}
      </motion.div>

      {/* Billing Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-green-400" />
                Billing Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Configure billing, payment, and subscription settings for Stripe integration
              </p>
            </div>
            <button
              onClick={() => setBillingExpanded(!billingExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {billingExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {billingExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-green-400 font-medium text-sm">About Billing Configuration</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Billing configuration controls payment grace periods, Stripe subscription management, and Pilot Credit boost packs. These settings integrate with Stripe for subscription billing, handle payment failures gracefully, and manage one-time credit purchases.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-green-300">Payment Grace Period:</strong> When subscription payment fails, users get X days to update payment method before agents pause. Prevents workflow interruption for temporary card issues. Agents run normally during grace period.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Boost Packs:</strong> One-time Pilot Credit purchases via Stripe. Users buy credit bundles (e.g., 10,000 credits for $5) when subscription allowance runs out. Includes bonus percentage incentive (e.g., buy 10K, get 11K).
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Pilot Credit Cost:</strong> Conversion rate from USD to Pilot Credits. Example: $0.0005 per credit = $5 buys 10,000 credits. Affects both subscription value and boost pack pricing.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Stripe Integration:</strong> All payments processed through Stripe. Subscriptions = recurring monthly credits. Boost packs = one-time payments. Webhook-driven for real-time credit allocation.
                    </p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-2">
                    <p className="text-green-300 text-xs font-medium mb-1">Grace Period Example</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      With <strong className="text-white">3-day grace period</strong>: Payment fails on Monday → user notified immediately → agents keep running → grace expires Thursday morning → agents auto-pause → user updates card → agents resume within minutes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Grace Period Configuration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-green-400" />
                  <h3 className="text-base font-medium text-white">Payment Grace Period</h3>
                </div>
                <button
                  onClick={handleSaveBillingConfig}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Grace Period (Days)
                  </label>
                  <input
                    type="number"
                    value={billingConfig.paymentGracePeriodDays}
                    onChange={(e) => setBillingConfig({
                      ...billingConfig,
                      paymentGracePeriodDays: parseInt(e.target.value) || 3
                    })}
                    min="0"
                    max="30"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                  />
                  <p className="text-xs text-slate-500">
                    Number of days to wait after a payment failure before pausing agents.
                    Default is 3 days. Set to 0 to pause agents immediately after payment failure.
                    Maximum is 30 days. This applies to all subscription renewals and recurring payments.
                  </p>
                </div>
              </div>

              {/* Grace Period Examples */}
              <div className="bg-slate-700/30 rounded-lg p-4 space-y-3">
                <div className="text-sm font-medium text-slate-300">Example Scenarios:</div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5"></div>
                    <div>
                      <span className="text-slate-400">Grace Period = 0 days:</span>
                      <span className="text-slate-300"> Agents pause immediately when payment fails. Strictest setting for critical payment enforcement.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5"></div>
                    <div>
                      <span className="text-slate-400">Grace Period = 3 days (default):</span>
                      <span className="text-slate-300"> Agents continue running for 3 days after payment failure. User has 3 days to update payment method before interruption.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5"></div>
                    <div>
                      <span className="text-slate-400">Grace Period = 7 days:</span>
                      <span className="text-slate-300"> Extended grace period for more flexible payment management. Agents run for a full week after payment failure.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Technical Notes */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-blue-400 font-medium text-xs">Technical Details</p>
                    <ul className="text-slate-300 text-xs space-y-1 list-disc list-inside">
                      <li>Grace period starts counting from the billing period end date, not the failed payment date</li>
                      <li>Stripe automatically retries failed payments according to your Stripe Dashboard settings</li>
                      <li>Users can update their payment method via the Customer Portal at any time during grace period</li>
                      <li>When payment succeeds during grace period, agents remain active and grace period resets</li>
                      <li>System checks grace period expiration when processing <code className="text-blue-300">invoice.payment_failed</code> webhook events</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Boost Pack Management */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <h3 className="text-base font-medium text-white">Boost Pack Management</h3>
                </div>
                <button
                  onClick={() => setShowAddBoostPack(true)}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Add Boost Pack
                </button>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-yellow-400 font-medium text-sm">How Boost Packs Work</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      Boost packs are one-time credit purchases. Set the price (USD) and bonus percentage,
                      and the system automatically calculates the Pilot Credits. All calculations are saved
                      to the database - the UI simply reads the pre-calculated values for optimal performance.
                    </p>
                  </div>
                </div>
              </div>

              {/* Boost Pack List */}
              <div className="space-y-3">
                {boostPacks.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Zap className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No boost packs configured yet</p>
                    <p className="text-sm mt-1">Click "Add Boost Pack" to create one</p>
                  </div>
                ) : (
                  boostPacks.map((pack) => {
                    const { baseCredits, bonusCredits } = calculateBoostPackCredits(pack.price_usd, pack.bonus_percentage);
                    const isEditing = editingBoostPack === pack.id;

                    return (
                      <div key={pack.id} className="bg-slate-700/30 rounded-lg p-4 space-y-3">
                        {isEditing ? (
                          // Edit Mode
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400">Pack Key</label>
                                <input
                                  type="text"
                                  value={pack.pack_key}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, pack_key: e.target.value } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="boost_quick"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400">Pack Name</label>
                                <input
                                  type="text"
                                  value={pack.pack_name}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, pack_name: e.target.value } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="Quick Boost"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400">Display Name</label>
                                <input
                                  type="text"
                                  value={pack.display_name}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, display_name: e.target.value } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="Quick Boost"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400">Badge Text (Optional)</label>
                                <input
                                  type="text"
                                  value={pack.badge_text || ''}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, badge_text: e.target.value || null } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="POPULAR"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-xs text-slate-400">Description</label>
                              <input
                                type="text"
                                value={pack.description}
                                onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                  p.id === pack.id ? { ...p, description: e.target.value } : p
                                ))}
                                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                placeholder="Perfect for a quick credit refill"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400">Price (USD)</label>
                                <input
                                  type="number"
                                  value={pack.price_usd}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, price_usd: parseFloat(e.target.value) || 0 } : p
                                  ))}
                                  step="0.01"
                                  min="0"
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400">Bonus (%)</label>
                                <input
                                  type="number"
                                  value={pack.bonus_percentage}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, bonus_percentage: parseFloat(e.target.value) || 0 } : p
                                  ))}
                                  step="1"
                                  min="0"
                                  max="100"
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                />
                              </div>
                            </div>

                            <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                              <div className="text-xs text-slate-400">Calculated Credits (will be saved to database):</div>
                              <div className="flex items-center gap-4 text-sm">
                                <div>
                                  <span className="text-slate-400">Base:</span>
                                  <span className="text-white font-semibold ml-2">{baseCredits.toLocaleString()}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Bonus:</span>
                                  <span className="text-green-400 font-semibold ml-2">+{bonusCredits.toLocaleString()}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Total:</span>
                                  <span className="text-blue-400 font-semibold ml-2">{(baseCredits + bonusCredits).toLocaleString()}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 text-sm text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={pack.is_active}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, is_active: e.target.checked } : p
                                  ))}
                                  className="rounded"
                                />
                                Active (visible to users)
                              </label>
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                              <button
                                onClick={() => handleSaveBoostPack(pack)}
                                disabled={saving}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingBoostPack(null);
                                  setDeletingBoostPack(null);
                                }}
                                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                <X className="w-4 h-4" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          // View Mode
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h4 className="text-white font-semibold">{pack.pack_name}</h4>
                                {pack.badge_text && (
                                  <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded">
                                    {pack.badge_text}
                                  </span>
                                )}
                                {!pack.is_active && (
                                  <span className="px-2 py-0.5 bg-slate-500/20 text-slate-400 text-xs font-semibold rounded">
                                    INACTIVE
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-400 mb-2">{pack.description}</p>
                              <div className="flex items-center gap-4 text-sm">
                                <div>
                                  <span className="text-slate-400">Price:</span>
                                  <span className="text-white font-semibold ml-2">${pack.price_usd.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Credits:</span>
                                  <span className="text-white font-semibold ml-2">{pack.credits_amount.toLocaleString()}</span>
                                </div>
                                {pack.bonus_credits > 0 && (
                                  <div>
                                    <span className="text-slate-400">Bonus:</span>
                                    <span className="text-green-400 font-semibold ml-2">+{pack.bonus_credits.toLocaleString()}</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-slate-400">Bonus %:</span>
                                  <span className="text-yellow-400 font-semibold ml-2">{pack.bonus_percentage}%</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {deletingBoostPack === pack.id ? (
                                // Delete confirmation buttons
                                <div className="flex items-center gap-2 bg-red-500/10 px-3 py-1 rounded border border-red-500/30">
                                  <span className="text-xs text-red-400 font-medium">Delete?</span>
                                  <button
                                    onClick={() => handleDeleteBoostPack(pack.id!)}
                                    disabled={saving}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white rounded text-xs transition-colors"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    onClick={() => setDeletingBoostPack(null)}
                                    className="px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs transition-colors"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                // Normal edit/delete buttons
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingBoostPack(pack.id!);
                                      setDeletingBoostPack(null);
                                    }}
                                    className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                                    title="Edit"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingBoostPack(pack.id!)}
                                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                                    title="Delete"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add New Boost Pack Modal/Form */}
              {showAddBoostPack && (
                <div className="bg-slate-700/50 rounded-lg p-4 space-y-3 border-2 border-yellow-500/30">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <h4 className="text-white font-semibold flex items-center gap-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      Add New Boost Pack
                    </h4>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Pack Key *</label>
                      <input
                        type="text"
                        value={newBoostPack.pack_key}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, pack_key: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="boost_quick"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Pack Name *</label>
                      <input
                        type="text"
                        value={newBoostPack.pack_name}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, pack_name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="Quick Boost"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Display Name *</label>
                      <input
                        type="text"
                        value={newBoostPack.display_name}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, display_name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="Quick Boost"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Badge Text (Optional)</label>
                      <input
                        type="text"
                        value={newBoostPack.badge_text || ''}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, badge_text: e.target.value || null })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="POPULAR"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400">Description *</label>
                    <input
                      type="text"
                      value={newBoostPack.description}
                      onChange={(e) => setNewBoostPack({ ...newBoostPack, description: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                      placeholder="Perfect for a quick credit refill"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Price (USD) *</label>
                      <input
                        type="number"
                        value={newBoostPack.price_usd}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, price_usd: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        min="0"
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Bonus (%) *</label>
                      <input
                        type="number"
                        value={newBoostPack.bonus_percentage}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, bonus_percentage: parseFloat(e.target.value) || 0 })}
                        step="1"
                        min="0"
                        max="100"
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-slate-400">Calculated Credits (will be saved to database):</div>
                    <div className="flex items-center gap-4 text-sm">
                      {(() => {
                        const { baseCredits, bonusCredits } = calculateBoostPackCredits(newBoostPack.price_usd, newBoostPack.bonus_percentage);
                        return (
                          <>
                            <div>
                              <span className="text-slate-400">Base:</span>
                              <span className="text-white font-semibold ml-2">{baseCredits.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-400">Bonus:</span>
                              <span className="text-green-400 font-semibold ml-2">+{bonusCredits.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-400">Total:</span>
                              <span className="text-blue-400 font-semibold ml-2">{(baseCredits + bonusCredits).toLocaleString()}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => handleSaveBoostPack(newBoostPack)}
                      disabled={saving || !newBoostPack.pack_key || !newBoostPack.pack_name}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Create Boost Pack
                    </button>
                    <button
                      onClick={() => {
                        setShowAddBoostPack(false);
                        setNewBoostPack({
                          pack_key: '',
                          pack_name: '',
                          display_name: '',
                          description: '',
                          price_usd: 10,
                          bonus_percentage: 0,
                          credits_amount: 0,
                          bonus_credits: 0,
                          badge_text: null,
                          is_active: true
                        });
                      }}
                      className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Calculator Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-purple-400" />
                Calculator Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Estimation parameters for the Pilot Credit usage calculator shown to users
              </p>
            </div>
            <button
              onClick={() => setCalcExpanded(!calcExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {calcExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {calcExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Sliders className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-purple-400 font-medium text-sm">About Calculator Configuration</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    These parameters power the Pilot Credit calculator that estimates usage costs for users when they design agents. The calculator provides cost transparency during agent creation, helping users understand resource requirements before deployment.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-purple-300">Token Parameters:</strong> Estimate AI model token usage based on agent complexity (plugins, workflow steps, iterations). Affects predicted LLM costs.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-purple-300">Execution Parameters:</strong> Estimate runtime behavior (iterations, duration, retry rates). Determines execution complexity multipliers.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-purple-300">Pricing Parameters:</strong> Convert technical estimates into Pilot Credit costs. Includes base fees, plugin overhead, system infrastructure costs.
                    </p>
                  </div>
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mt-2">
                    <p className="text-purple-300 text-xs font-medium mb-1">Important Note</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      These settings only affect the <strong className="text-white">cost estimator shown to users</strong>. Actual billing is calculated from real execution metrics. Adjust these values to match your infrastructure costs and desired pricing model.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Token Estimation */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <Database className="w-4 h-4 text-blue-400" />
                Token Estimation
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Base Tokens
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseTokens}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseTokens: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Foundation Tokens (default: 5000)</p>
                    <p className="text-slate-400">Starting token count for basic agent with no plugins. Affects cost estimation baseline for all agent calculations.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Tokens Per Plugin
                  </label>
                  <input
                    type="number"
                    value={calcConfig.tokensPerPlugin}
                    onChange={(e) => setCalcConfig({ ...calcConfig, tokensPerPlugin: parseFloat(e.target.value) })}
                    min="0"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Plugin Token Cost (default: 800)</p>
                    <p className="text-slate-400">How many extra tokens each connected plugin adds to the agent's usage. Includes plugin metadata and orchestration overhead.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Peak Multiplier
                  </label>
                  <input
                    type="number"
                    value={calcConfig.peakMultiplier}
                    onChange={(e) => setCalcConfig({ ...calcConfig, peakMultiplier: parseFloat(e.target.value) })}
                    min="1"
                    max="3"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Burst Factor (default: 1.5)</p>
                    <p className="text-slate-400">Maximum usage spike multiplier. 1.5 means peak usage can be 50% higher than average during complex operations.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Plugin Usage Rate
                  </label>
                  <input
                    type="number"
                    value={calcConfig.pluginUsageRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, pluginUsageRate: parseFloat(e.target.value) })}
                    min="0"
                    max="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">Active Usage Percentage (default: 0.8)</p>
                    <p className="text-slate-400">What percentage of connected plugins actually get used per run. 0.8 = 80% active usage rate across agent executions.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-yellow-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Orchestration Overhead (ms)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.orchestrationOverheadMs}
                    onChange={(e) => setCalcConfig({ ...calcConfig, orchestrationOverheadMs: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-yellow-300 font-medium mb-1">Coordination Time (default: 500ms)</p>
                    <p className="text-slate-400">Extra time spent coordinating between plugins during execution. Includes API calls and data transformation overhead.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Estimated Duration (ms)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedDurationMs}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedDurationMs: parseFloat(e.target.value) })}
                    min="0"
                    step="1000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Average Execution Time (default: 15000ms)</p>
                    <p className="text-slate-400">How long a typical agent execution takes from start to finish. Used for timeout and resource allocation estimates.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Estimated Failure Rate (%)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedFailureRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedFailureRate: parseFloat(e.target.value) })}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-300 font-medium mb-1">Error Rate (default: 5%)</p>
                    <p className="text-slate-400">Expected percentage of agent runs that fail. Used to calculate retry overhead and reliability margins in cost estimates.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-orange-300 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Estimated Retry Rate
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedRetryRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedRetryRate: parseFloat(e.target.value) })}
                    min="0"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-orange-300 font-medium mb-1">Retry Multiplier (default: 0.3)</p>
                    <p className="text-slate-400">How many times agents retry on failure. 0.3 means 30% of failures result in one retry attempt.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-indigo-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    I/O Ratio
                  </label>
                  <input
                    type="number"
                    value={calcConfig.ioRatio}
                    onChange={(e) => setCalcConfig({ ...calcConfig, ioRatio: parseFloat(e.target.value) })}
                    min="0"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-indigo-300 font-medium mb-1">Output/Input Token Ratio (default: 2.0)</p>
                    <p className="text-slate-400">Ratio of tokens generated vs consumed. 2.0 means agent generates twice as many tokens as it reads from inputs.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Execution Parameters */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <Zap className="w-4 h-4 text-yellow-400" />
                Execution Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-yellow-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Base Iterations
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseIterations}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseIterations: parseFloat(e.target.value) })}
                    min="1"
                    max="20"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-yellow-300 font-medium mb-1">Minimum Cycles (default: 3)</p>
                    <p className="text-slate-400">Fewest loops/cycles a simple agent runs before completing its task. Affects baseline runtime estimation.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Max Iterations
                  </label>
                  <input
                    type="number"
                    value={calcConfig.maxIterations}
                    onChange={(e) => setCalcConfig({ ...calcConfig, maxIterations: parseFloat(e.target.value) })}
                    min="1"
                    max="50"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-300 font-medium mb-1">Safety Limit (default: 15)</p>
                    <p className="text-slate-400">Maximum loops/cycles before stopping complex agents. Prevents infinite runs and runaway costs.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Parameters */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <DollarSign className="w-4 h-4 text-green-400" />
                Pricing Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Runs Per Agent Per Month
                  </label>
                  <input
                    type="number"
                    value={calcConfig.runsPerAgentPerMonth}
                    onChange={(e) => setCalcConfig({ ...calcConfig, runsPerAgentPerMonth: parseFloat(e.target.value) })}
                    min="1"
                    max="1000"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Average Monthly Usage (default: 30)</p>
                    <p className="text-slate-400">How many times users run each agent per month. Used to calculate monthly cost projections in the calculator.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    Agent Creation Cost (Pilot Credits)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.agentCreationCost}
                    onChange={(e) => setCalcConfig({ ...calcConfig, agentCreationCost: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">One-Time Creation Fee (default: 1000)</p>
                    <p className="text-slate-400">Pilot Credits charged when user first creates an agent. One-time setup fee to cover AI-assisted agent building.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Credit Cost (USD)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.creditCostUsd}
                    onChange={(e) => setCalcConfig({ ...calcConfig, creditCostUsd: parseFloat(e.target.value) })}
                    min="0"
                    step="0.00001"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">Real Money Value (default: $0.00048)</p>
                    <p className="text-slate-400">How much 1 Pilot Credit costs in actual USD. Controls the conversion rate for billing calculations.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Minimum Monthly Cost (USD)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.minimumMonthlyCostUsd}
                    onChange={(e) => setCalcConfig({ ...calcConfig, minimumMonthlyCostUsd: parseFloat(e.target.value) })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-amber-300 font-medium mb-1">Floor Price (default: $0)</p>
                    <p className="text-slate-400">Minimum USD charged per month regardless of usage. Set to 0 for pure usage-based pricing.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Base Credits Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseCreditsPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseCreditsPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Flat Fee Per Run (default: 50)</p>
                    <p className="text-slate-400">Flat Pilot Credit cost for every agent run, before adding plugin overhead. Covers base AI model usage.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-indigo-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Plugin Overhead Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.pluginOverheadPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, pluginOverheadPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-indigo-300 font-medium mb-1">Plugin Fee (default: 20)</p>
                    <p className="text-slate-400">Extra Pilot Credits charged for each active plugin used during a run. Covers API calls and data processing.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5" />
                    System Overhead Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.systemOverheadPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, systemOverheadPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-slate-300 font-medium mb-1">Infrastructure Fee (default: 10)</p>
                    <p className="text-slate-400">Platform infrastructure cost per run. Credits for hosting, monitoring, logging, and system resources.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Execution Step Multiplier
                  </label>
                  <input
                    type="number"
                    value={calcConfig.executionStepMultiplier}
                    onChange={(e) => setCalcConfig({ ...calcConfig, executionStepMultiplier: parseFloat(e.target.value) })}
                    min="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Complexity Multiplier (default: 1.2)</p>
                    <p className="text-slate-400">Increases cost per iteration. 1.2 = 20% more credits per loop to account for increasing complexity.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    Free Tier Credits
                  </label>
                  <input
                    type="number"
                    value={calcConfig.freeTierCredits}
                    onChange={(e) => setCalcConfig({ ...calcConfig, freeTierCredits: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">Welcome Bonus (default: 1000)</p>
                    <p className="text-slate-400">Pilot Credits given to each new user for free trial. Enables testing before purchasing boost packs.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t border-white/10">
              <button
                onClick={handleSaveCalculatorConfig}
                disabled={saving}
                className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Calculator Config
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Workflow Pilot Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.13 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-cyan-400" />
                Workflow Pilot
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Configure complex multi-step workflows with conditionals, loops, and parallel execution
              </p>
            </div>
            <button
              onClick={() => setPilotExpanded(!pilotExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {pilotExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {pilotExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Settings className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-cyan-400 font-medium text-sm">How Workflow Pilot Works</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    The Workflow Pilot enables complex multi-step workflows with deterministic control flow. Agents with workflow_steps automatically use the pilot when enabled, providing enterprise-grade orchestration capabilities.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-cyan-300">Control Flow:</strong> Conditional branching (if/else), loops (iteration), parallel execution (concurrent steps), early exits, and dynamic step routing.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-cyan-300">Error Handling:</strong> Automatic retries with exponential backoff, circuit breakers to prevent cascading failures, fallback strategies, and granular error logging.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-cyan-300">State Management:</strong> Checkpoint-based state persistence enables pause/resume, failure recovery from last successful step, and long-running workflow support.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-cyan-300">Token Protection:</strong> AgentKit safeguards prevent runaway executions - response truncation, loop detection, per-iteration limits, and circuit breakers protect user credits.
                    </p>
                  </div>
                  <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 mt-2">
                    <p className="text-cyan-300 text-xs font-medium mb-1">Fallback Behavior</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      When pilot is <strong className="text-white">disabled</strong>, agents with workflow_steps fall back to AgentKit execution. Simple linear workflows still work, but advanced features (conditionals, loops, parallel steps) are not available.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Master Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-white">Enable Workflow Pilot</h3>
                  {pilotConfig.enabled ? (
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Active</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-600/50 text-slate-400 text-xs rounded-full">Disabled</span>
                  )}
                </div>
                <p className="text-sm text-slate-400">
                  When enabled, agents with workflow_steps will execute using the pilot. When disabled, they fall back to AgentKit.
                </p>
              </div>
              <button
                onClick={() => setPilotConfig({ ...pilotConfig, enabled: !pilotConfig.enabled })}
                className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                  pilotConfig.enabled ? 'bg-green-500' : 'bg-slate-600'
                }`}
              >
                <motion.div
                  className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                  animate={{ x: pilotConfig.enabled ? 32 : 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            {/* Execution Limits */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                Execution Limits
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Max Steps
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxSteps}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxSteps: parseInt(e.target.value) })}
                    min="1"
                    max="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Step Limit (default: 50)</p>
                    <p className="text-slate-400">Maximum workflow steps before timeout. Prevents runaway workflows from consuming excessive resources.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Max Execution Time (ms)
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxExecutionTimeMs}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxExecutionTimeMs: parseInt(e.target.value) })}
                    min="1000"
                    max="600000"
                    step="1000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-amber-300 font-medium mb-1">Timeout (default: 300000ms / 5 min)</p>
                    <p className="text-slate-400">Maximum execution time in milliseconds. Workflow automatically fails after this duration.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    Max Parallel Steps
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxParallelSteps}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxParallelSteps: parseInt(e.target.value) })}
                    min="1"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Concurrency Limit (default: 3)</p>
                    <p className="text-slate-400">Concurrent steps allowed to run simultaneously. Prevents resource exhaustion and manages API rate limits.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Error Recovery Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Error Recovery
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div>
                    <h4 className="text-sm font-medium text-white">Auto Retry</h4>
                    <p className="text-xs text-slate-400 mt-1">Retry failed steps automatically</p>
                  </div>
                  <button
                    onClick={() => setPilotConfig({ ...pilotConfig, retryEnabled: !pilotConfig.retryEnabled })}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      pilotConfig.retryEnabled ? 'bg-green-500' : 'bg-slate-600'
                    }`}
                  >
                    <motion.div
                      className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg"
                      animate={{ x: pilotConfig.retryEnabled ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Default Retry Count
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.defaultRetryCount}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, defaultRetryCount: parseInt(e.target.value) })}
                    min="0"
                    max="10"
                    disabled={!pilotConfig.retryEnabled}
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Retry Attempts (default: 3)</p>
                    <p className="text-slate-400">Number of automatic retries before marking step as failed. Helps overcome transient API errors.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Circuit Breaker Threshold
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.circuitBreakerThreshold}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, circuitBreakerThreshold: parseInt(e.target.value) })}
                    min="1"
                    max="20"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-300 font-medium mb-1">Failure Threshold (default: 5)</p>
                    <p className="text-slate-400">Consecutive failures before circuit opens and stops execution. Protects against cascading failures.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* State Management */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Database className="w-4 h-4" />
                State Management
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div>
                    <h4 className="text-sm font-medium text-white">Checkpointing</h4>
                    <p className="text-xs text-slate-400 mt-1">Save state after each step (enables pause/resume)</p>
                  </div>
                  <button
                    onClick={() => setPilotConfig({ ...pilotConfig, checkpointEnabled: !pilotConfig.checkpointEnabled })}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      pilotConfig.checkpointEnabled ? 'bg-green-500' : 'bg-slate-600'
                    }`}
                  >
                    <motion.div
                      className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg"
                      animate={{ x: pilotConfig.checkpointEnabled ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Retention (days)
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.retentionDays}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, retentionDays: parseInt(e.target.value) })}
                    min="1"
                    max="365"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Data Retention Period (default: 90 days)</p>
                    <p className="text-slate-400">Days to retain execution records before automatic cleanup. Longer retention enables audit and debugging.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* AgentKit Token Protection */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                AgentKit Token Protection
              </h3>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-amber-400 font-medium text-sm">Credit Exhaustion Protection</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      These safeguards prevent runaway AgentKit executions from exhausting user credits.
                      Includes <strong className="text-white">response truncation</strong> (large API responses),
                      <strong className="text-white"> loop detection</strong> (same tool called repeatedly),
                      <strong className="text-white"> per-iteration limits</strong>, and
                      <strong className="text-white"> circuit breakers</strong> (total execution limit).
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Max Tool Response Chars
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxToolResponseChars || 8000}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxToolResponseChars: parseInt(e.target.value) })}
                    min="1000"
                    max="50000"
                    step="1000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-amber-300 font-medium mb-1">Response Truncation (default: 8000 chars / ~2000 tokens)</p>
                    <p className="text-slate-400">Maximum characters in plugin/tool responses before truncation. Protects against large email fetches or API responses.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-orange-300 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Loop Detection Window
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.loopDetectionWindow || 3}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, loopDetectionWindow: parseInt(e.target.value) })}
                    min="2"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-orange-300 font-medium mb-1">Pattern Detection (default: 3 calls)</p>
                    <p className="text-slate-400">Number of recent tool calls to monitor for loop detection. System tracks this many recent calls to identify patterns.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Max Same Tool Repeats
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxSameToolRepeats || 3}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxSameToolRepeats: parseInt(e.target.value) })}
                    min="2"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-300 font-medium mb-1">Infinite Loop Protection (default: 3 repeats)</p>
                    <p className="text-slate-400">How many times the same tool can be called consecutively. Execution stops immediately when loop is detected.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Max Tokens Per Iteration
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxTokensPerIteration || 50000}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxTokensPerIteration: parseInt(e.target.value) })}
                    min="10000"
                    max="200000"
                    step="10000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Per-Iteration Limit (default: 50K tokens)</p>
                    <p className="text-slate-400">Maximum tokens for a single AgentKit iteration (one AI call + tool executions). Prevents excessive credit use per step.</p>
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-red-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Total Execution Token Limit
                  </label>
                  <input
                    type="number"
                    value={pilotConfig.maxTotalExecutionTokens || 200000}
                    onChange={(e) => setPilotConfig({ ...pilotConfig, maxTotalExecutionTokens: parseInt(e.target.value) })}
                    min="50000"
                    max="500000"
                    step="50000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-400 font-medium mb-1">Circuit Breaker (default: 200K tokens / ~$0.60 at GPT-4 pricing)</p>
                    <p className="text-slate-400">Emergency stop limit for entire AgentKit execution (all iterations combined). Prevents catastrophic credit exhaustion.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Per-Step Intelligent Routing */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Brain className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-blue-400 font-medium text-sm">Per-Step Intelligent Routing</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      Optimize token costs by analyzing each Pilot step individually to select the most cost-efficient model.
                      Unlike global AIS routing (which uses one model for all steps), per-step routing can use
                      <strong className="text-white"> gpt-4o-mini</strong> for simple steps,
                      <strong className="text-white"> Claude Haiku</strong> for medium complexity, and
                      <strong className="text-white"> gpt-4o</strong> only for complex reasoning.
                      Expected savings: <strong className="text-green-400">30-50%</strong> on token costs.
                    </p>
                  </div>
                </div>
              </div>

              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Brain className="w-4 h-4" />
                Per-Step Model Routing
              </h3>

              {/* Enable Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-white">Enable Per-Step Routing</h3>
                    {pilotConfig.perStepRoutingEnabled ? (
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Active</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-600/50 text-slate-400 text-xs rounded-full">Disabled</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">
                    When enabled, each Pilot step is analyzed for complexity and routed to the optimal model tier.
                    This overrides global AIS routing for Pilot executions.
                  </p>
                </div>
                <button
                  onClick={() => setPilotConfig({ ...pilotConfig, perStepRoutingEnabled: !pilotConfig.perStepRoutingEnabled })}
                  className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                    pilotConfig.perStepRoutingEnabled ? 'bg-green-500' : 'bg-slate-600'
                  }`}
                >
                  <motion.div
                    className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    animate={{ x: pilotConfig.perStepRoutingEnabled ? 32 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>

              {/* Routing Strategy */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Routing Strategy</label>
                <select
                  value={pilotConfig.routingStrategy}
                  onChange={(e) => setPilotConfig({ ...pilotConfig, routingStrategy: e.target.value })}
                  disabled={!pilotConfig.perStepRoutingEnabled}
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="conservative">Conservative (60% AIS, 40% Step Complexity)</option>
                  <option value="balanced">Balanced (40% AIS, 60% Step Complexity) - Recommended</option>
                  <option value="aggressive">Aggressive (20% AIS, 80% Step Complexity)</option>
                </select>
                <p className="text-xs text-slate-500">
                  {pilotConfig.routingStrategy === 'conservative' && 'Conservative: Trusts agent AIS score more. Safer but may not optimize as aggressively.'}
                  {pilotConfig.routingStrategy === 'balanced' && 'Balanced: Equal weight on agent AIS and step complexity. Best for most use cases.'}
                  {pilotConfig.routingStrategy === 'aggressive' && 'Aggressive: Trusts step-level analysis more. Maximum cost savings but may downgrade capable agents.'}
                </p>
              </div>

              <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
                <p className="text-xs text-slate-400">
                  <strong className="text-slate-300">Note:</strong> Additional routing parameters (complexity thresholds, tier models, factor weights)
                  are configured in the <strong className="text-cyan-400">AIS Config</strong> admin page.
                </p>
              </div>
            </div>

            {/* Workflow Orchestrator Configuration */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Brain className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-purple-400 font-medium text-sm">Workflow Orchestrator - AI Model Selection</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      The orchestrator generates Pilot workflows when users create agents. By default, it uses
                      <strong className="text-white"> GPT-4o Mini</strong> (~$0.001/agent) which provides
                      <strong className="text-green-400"> 97% cost savings</strong> compared to
                      <strong className="text-white"> Claude Sonnet 4</strong> (~$0.03/agent).
                      Enable automatic fallback to Claude for quality assurance when GPT-4o Mini fails validation.
                    </p>
                  </div>
                </div>
              </div>

              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Brain className="w-4 h-4" />
                Workflow Generation Models
              </h3>

              {/* Primary Model Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Primary Generator</label>
                <select
                  value={orchestratorConfig.primaryModel}
                  onChange={(e) => {
                    const newPrimary = e.target.value as 'gpt-4o-mini' | 'claude-sonnet-4';
                    // Auto-adjust fallback to the opposite model
                    const newFallback = newPrimary === 'gpt-4o-mini' ? 'claude-sonnet-4' : 'gpt-4o-mini';
                    setOrchestratorConfig({
                      ...orchestratorConfig,
                      primaryModel: newPrimary,
                      fallbackModel: newFallback
                    });
                  }}
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini (~$0.001/agent) - Recommended</option>
                  <option value="claude-sonnet-4">Claude Sonnet 4 (~$0.03/agent)</option>
                </select>
                <div className="bg-slate-700/30 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-slate-400">
                    {orchestratorConfig.primaryModel === 'gpt-4o-mini' && (
                      <>
                        <strong className="text-green-400">GPT-4o Mini:</strong> Cost-efficient model with 97% savings.
                        Fast generation (~1-2s). Good quality with validation fallback enabled.
                        Recommended for production use.
                      </>
                    )}
                    {orchestratorConfig.primaryModel === 'claude-sonnet-4' && (
                      <>
                        <strong className="text-purple-400">Claude Sonnet 4:</strong> Premium model with highest quality.
                        Excellent structured output and reasoning. Use when cost is not a primary concern.
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Fallback Model Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Fallback Generator</label>
                <select
                  value={orchestratorConfig.fallbackModel}
                  onChange={(e) => setOrchestratorConfig({ ...orchestratorConfig, fallbackModel: e.target.value as 'gpt-4o-mini' | 'claude-sonnet-4' })}
                  disabled={!orchestratorConfig.enableFallback}
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="claude-sonnet-4">Claude Sonnet 4 (~$0.03/agent)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (~$0.001/agent)</option>
                </select>
                <p className="text-xs text-slate-500">
                  Used automatically when primary generator fails validation or encounters errors.
                  {!orchestratorConfig.enableFallback && ' (Currently disabled)'}
                </p>
              </div>

              {/* Enable Fallback Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-white">Enable Automatic Fallback</h3>
                    {orchestratorConfig.enableFallback ? (
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Active</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-600/50 text-slate-400 text-xs rounded-full">Disabled</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">
                    When enabled, if the primary generator fails validation, automatically retry with fallback generator.
                    Recommended to keep enabled for production reliability.
                  </p>
                </div>
                <button
                  onClick={() => setOrchestratorConfig({ ...orchestratorConfig, enableFallback: !orchestratorConfig.enableFallback })}
                  className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
                    orchestratorConfig.enableFallback ? 'bg-green-500' : 'bg-slate-600'
                  }`}
                >
                  <motion.div
                    className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    animate={{ x: orchestratorConfig.enableFallback ? 32 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>

              {/* Cost Comparison */}
              <div className="bg-slate-700/30 rounded-lg p-4 space-y-3">
                <p className="text-xs font-medium text-slate-300">Cost Comparison (at 10,000 agents/month):</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Claude Sonnet 4 only:</span>
                    <span className="text-red-400 font-mono">~$300/month</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">GPT-4o Mini only:</span>
                    <span className="text-green-400 font-mono">~$10/month</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">GPT-4o Mini + 5% fallback:</span>
                    <span className="text-green-400 font-mono">~$25/month</span>
                  </div>
                  <div className="pt-2 border-t border-white/10 flex justify-between text-xs font-medium">
                    <span className="text-white">Potential Annual Savings:</span>
                    <span className="text-green-400 font-mono">~$3,300/year</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t border-white/10">
              <button
                onClick={handleSavePilotConfig}
                disabled={saving}
                className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Pilot Config
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Memory System Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Brain className="w-5 h-5 text-teal-400" />
                Memory System Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Configure AI memory system for agent execution context, summarization, and learning
              </p>
            </div>
            <button
              onClick={() => setMemoryExpanded(!memoryExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {memoryExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {memoryExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-teal-500/10 border border-teal-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-teal-400 font-medium text-sm">How Memory System Works</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    The Memory System enhances agent executions with context from past runs, enabling agents to learn from experience and maintain continuity across interactions. Memory injection happens before execution, while summarization occurs asynchronously after completion.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-teal-300">Before Execution (Injection):</strong> System loads relevant memories within token budget - recent runs (chronological), semantic matches (vector search), user preferences, and learned patterns. Prioritized by importance scoring.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-teal-300">After Execution (Summarization):</strong> AI model (gpt-4o-mini by default) analyzes the execution and creates a concise summary. Runs asynchronously to avoid blocking user response. Summaries are embedded for future semantic search.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-teal-300">Importance Scoring:</strong> Memories are scored based on recency, error patterns, user feedback, milestones. High-importance memories are prioritized during injection and retained longer.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-teal-300">AIS Integration:</strong> Memory context helps agents make better decisions while Intelligent Routing selects cost-efficient models. Context-aware execution with optimized costs.
                    </p>
                  </div>
                  <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 mt-2">
                    <p className="text-teal-300 text-xs font-medium mb-1">Benefits</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      Agents remember past interactions, learn from errors, maintain user context, and improve over time. Memory enables <strong className="text-white">personalization</strong>, <strong className="text-white">error prevention</strong>, and <strong className="text-white">continuous improvement</strong> without manual intervention.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Token Budget & Injection Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Memory Injection Settings</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('injection')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-teal-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Max Memory Tokens
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.max_tokens}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, max_tokens: parseInt(e.target.value) }
                    })}
                    min="100"
                    max="2000"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-teal-300 font-medium mb-1">Token Budget (recommended: 800)</p>
                    <p className="text-slate-400">Maximum tokens allocated for memory context. Higher values provide more context but consume more of the model's context window.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Min Recent Runs
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.min_recent_runs}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, min_recent_runs: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Minimum History (recommended: 3)</p>
                    <p className="text-slate-400">Minimum number of recent execution memories to always include, even if token budget is tight. Ensures basic continuity.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Max Recent Runs
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.max_recent_runs}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, max_recent_runs: parseInt(e.target.value) }
                    })}
                    min="3"
                    max="20"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Maximum History (recommended: 10)</p>
                    <p className="text-slate-400">Maximum number of recent runs to fetch and consider for injection. Space permitting within token budget.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5" />
                    Semantic Search Limit
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.injection.semantic_search_limit}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      injection: { ...memoryConfig.injection, semantic_search_limit: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Vector Search Results (recommended: 5)</p>
                    <p className="text-slate-400">Maximum semantically similar memories to retrieve using vector search. Requires embeddings to be generated.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Summarization Settings */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Memory Summarization Settings</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('summarization')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    Summarization Model
                  </label>
                  <select
                    value={memoryConfig.summarization.model}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      summarization: { ...memoryConfig.summarization, model: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (recommended)</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                  </select>
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">AI Model (recommended: gpt-4o-mini)</p>
                    <p className="text-slate-400">LLM used to analyze executions and create concise memory summaries. gpt-4o-mini provides good quality at ~$0.0003 per run.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Temperature
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.summarization.temperature}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      summarization: { ...memoryConfig.summarization, temperature: parseFloat(e.target.value) }
                    })}
                    min="0"
                    max="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-amber-300 font-medium mb-1">Creativity Setting (recommended: 0.3)</p>
                    <p className="text-slate-400">Controls randomness in summary generation. Lower (0.3) = consistent, focused. Higher (0.7+) = creative.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.summarization.max_tokens}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      summarization: { ...memoryConfig.summarization, max_tokens: parseInt(e.target.value) }
                    })}
                    min="100"
                    max="1000"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Summary Length (recommended: 500)</p>
                    <p className="text-slate-400">Maximum length of generated memory summaries in tokens. Higher = more detailed but increased cost.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Async Summarization
                  </label>
                  <div className="flex items-center h-[42px]">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={memoryConfig.summarization.async}
                        onChange={(e) => setMemoryConfig({
                          ...memoryConfig,
                          summarization: { ...memoryConfig.summarization, async: e.target.checked }
                        })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                      <span className="ml-3 text-sm text-slate-300">{memoryConfig.summarization.async ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Background Processing (recommended: enabled)</p>
                    <p className="text-slate-400">When enabled, memory summarization runs in the background. Prevents blocking user response.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Importance Scoring Settings */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Importance Scoring Weights</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('importance')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>
              <p className="text-xs text-slate-400">These weights determine memory importance scores (1-10), which affect retention and priority. Higher importance memories are kept longer and loaded first.</p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Base Score</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.base_score}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, base_score: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Starting importance for all memories</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Error Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.error_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, error_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added for failed executions (learn from errors)</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Pattern Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.pattern_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, pattern_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added when recurring patterns detected</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">User Feedback Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.user_feedback_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, user_feedback_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added when user provides explicit feedback</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">First Run Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.first_run_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, first_run_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added for agent's first execution (baseline)</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Milestone Bonus</label>
                  <input
                    type="number"
                    value={memoryConfig.importance.milestone_bonus}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      importance: { ...memoryConfig.importance, milestone_bonus: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Added every 10th run (checkpoints)</p>
                </div>
              </div>
            </div>

            {/* Retention Policy */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Memory Retention Policy</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('retention')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Run Memories (Days)
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.run_memories_days}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, run_memories_days: parseInt(e.target.value) }
                    })}
                    min="7"
                    max="365"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Retention period for medium-importance memories (score 5-7). Balances context availability with database growth (recommended: 90 days).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Low Importance (Days)
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.low_importance_days}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, low_importance_days: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="90"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Retention period for low-importance memories (score 1-4). Routine successes without insights cleaned up sooner (recommended: 30 days).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Consolidation Threshold
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.consolidation_threshold}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, consolidation_threshold: parseInt(e.target.value) }
                    })}
                    min="10"
                    max="200"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Number of memories that triggers consolidation. When agent accumulates this many memories, similar patterns merge into consolidated insights (recommended: 50).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Consolidation Frequency (Days)
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.retention.consolidation_frequency_days}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      retention: { ...memoryConfig.retention, consolidation_frequency_days: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="30"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">How often to run memory consolidation job. Lower frequency keeps memories fresher but uses more compute (recommended: 7 days).</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">Note: High-importance memories (score 8-10) with critical patterns, errors, or user feedback are kept indefinitely.</p>
            </div>

            {/* Embedding Settings */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">Embedding Configuration</h3>
                <button
                  onClick={() => handleSaveMemoryConfig('embedding')}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Embedding Model
                  </label>
                  <select
                    value={memoryConfig.embedding.model}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      embedding: { ...memoryConfig.embedding, model: e.target.value }
                    })}
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  >
                    <option value="text-embedding-3-small">text-embedding-3-small (recommended)</option>
                    <option value="text-embedding-3-large">text-embedding-3-large</option>
                    <option value="text-embedding-ada-002">text-embedding-ada-002</option>
                  </select>
                  <p className="text-xs text-slate-500">OpenAI model for generating vector embeddings. Used for semantic search to find similar memories based on meaning (recommended: text-embedding-3-small).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Batch Size
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.embedding.batch_size}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      embedding: { ...memoryConfig.embedding, batch_size: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="500"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Number of memories to process in a single batch when generating embeddings. Higher values are more efficient but use more memory (recommended: 100).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Dimensions
                  </label>
                  <input
                    type="number"
                    value={memoryConfig.embedding.dimensions}
                    onChange={(e) => setMemoryConfig({
                      ...memoryConfig,
                      embedding: { ...memoryConfig.embedding, dimensions: parseInt(e.target.value) }
                    })}
                    min="256"
                    max="3072"
                    step="256"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-teal-500"
                  />
                  <p className="text-xs text-slate-500">Vector embedding dimension size. Higher dimensions provide better semantic accuracy but require more storage (recommended: 1536 for text-embedding-3-small).</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Advanced System Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-orange-400" />
                Advanced Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Complete system configuration in JSON format. Use with caution - incorrect values may affect platform stability.
              </p>
            </div>
            <button
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {advancedExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>
        {advancedExpanded && (
          <div className="p-6">
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-400 text-sm font-medium">Advanced Settings</p>
                  <p className="text-slate-400 text-xs mt-1">
                    This is a read-only view of all system settings. To modify values, use the specific configuration sections above.
                  </p>
                </div>
              </div>
              <pre className="text-xs text-slate-300 bg-slate-950 p-4 rounded-lg overflow-x-auto border border-slate-800">
                {JSON.stringify({
                  routing: {
                    intelligent_routing_enabled: routingEnabled,
                    routing_low_threshold: lowThreshold,
                    routing_medium_threshold: mediumThreshold,
                    routing_min_success_rate: minSuccessRate,
                    anthropic_provider_enabled: anthropicEnabled,
                    note: "Routing threshold controlled by min_executions_for_score in AIS Config"
                  },
                  calculator: calcConfig,
                  pricing_models: pricingModels.map(m => ({
                    provider: m.provider,
                    model: m.model_name,
                    input_cost: m.input_cost_per_token,
                    output_cost: m.output_cost_per_token
                  }))
                }, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </motion.div>

    </div>
  );
}
