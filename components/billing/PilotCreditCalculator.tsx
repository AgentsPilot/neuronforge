// components/billing/PilotCreditCalculator.tsx
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Zap, TrendingUp, Check, CheckCircle, ArrowRight } from 'lucide-react';

interface CalculatorInputs {
  numAgents: number;
  avgPluginsPerAgent: number;
}

interface CalculationResult {
  monthlyCredits: number;
  monthlyAmount: number;
  estimatedExecutions: number;
  creditsPerDay: number;
}

interface PilotCreditCalculatorProps {
  onCalculate?: (inputs: CalculatorInputs, result: CalculationResult) => void;
  initialInputs?: CalculatorInputs;
  showSubscribeButton?: boolean;
  onSubscribe?: (monthlyCredits: number, inputs: CalculatorInputs) => void;
}

interface AisTier {
  min: number;
  max: number;
  score: number;
}

interface ExecutionSteps {
  plugins: number;
  steps: number;
}

interface PricingConfig {
  baseCreditsPerRun: number;
  pluginOverheadPerRun: number;
  systemOverheadPerRun: number;
  runsPerAgentPerMonth: number;
  creditCostUsd: number;
  minimumMonthlyCostUsd: number;
  agentCreationCost: number;
  executionStepMultiplier: number;
  aisTiers: AisTier[];
  executionStepsByPlugins: ExecutionSteps[];
}

export default function PilotCreditCalculator({
  onCalculate,
  initialInputs,
  showSubscribeButton = false,
  onSubscribe
}: PilotCreditCalculatorProps) {
  const [inputs, setInputs] = useState<CalculatorInputs>(
    initialInputs || {
      numAgents: 5,
      avgPluginsPerAgent: 3,
    }
  );

  const [result, setResult] = useState<CalculationResult | null>(null);
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [aisRanges, setAisRanges] = useState<Record<string, { min: number; max: number }> | null>(null);
  const [aisMode, setAisMode] = useState<number>(0);
  const [fallbackCount, setFallbackCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Fetch pricing configuration and AIS ranges from database on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        console.log('🔄 [Calculator] Fetching pricing config and AIS ranges...');

        // Fetch both pricing config and AIS ranges in parallel
        const [configResponse, aisResponse] = await Promise.all([
          fetch('/api/pricing/config'),
          fetch('/api/pricing/ais-ranges')
        ]);

        console.log('📊 [Calculator] Config response status:', configResponse.status);
        console.log('📊 [Calculator] AIS response status:', aisResponse.status);

        const configData = await configResponse.json();
        const aisData = await aisResponse.json();

        console.log('📊 [Calculator] Config data:', configData);
        console.log('📊 [Calculator] AIS data:', aisData);

        if (configData.success) {
          setConfig(configData.config);
          console.log('✅ [Calculator] Pricing config loaded:', configData.config);
        } else {
          console.error('❌ [Calculator] Failed to fetch pricing config:', configData.error);
        }

        if (aisData.success) {
          setAisRanges(aisData.ranges);
          setAisMode(aisData.activeMode);
          setFallbackCount(aisData.fallbackCount || 0);
          console.log(`✅ [Calculator] Using AIS ${aisData.modeDescription} ranges`);
          console.log('📊 [Calculator] Active Mode:', aisData.activeMode);
          console.log('📊 [Calculator] AIS ranges loaded:', Object.keys(aisData.ranges).length, 'ranges');
          console.log('📊 [Calculator] ALL AIS ranges:', aisData.ranges);

          if (aisData.fallbackCount > 0) {
            console.warn(`⚠️ [Calculator] ${aisData.fallbackCount} ranges using best practice fallback`);
          }

          // Check for invalid ranges (min >= max)
          const invalidRanges = Object.entries(aisData.ranges).filter(([key, range]: [string, any]) => range.max <= range.min);
          if (invalidRanges.length > 0) {
            console.warn('⚠️ [Calculator] Found invalid ranges (min >= max):', invalidRanges);
          }
        } else {
          console.error('❌ [Calculator] Failed to fetch AIS ranges:', aisData.error);
        }
      } catch (error) {
        console.error('❌ [Calculator] Error fetching pricing data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  // Calculate credits based on inputs using database-driven configuration and AIS ranges
  useEffect(() => {
    if (config && aisRanges) {
      calculateCredits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, config, aisRanges]);

  // Normalize value to 0-10 scale using AIS ranges
  const normalizeToScale = (value: number, rangeKey: string): number => {
    if (!aisRanges || !aisRanges[rangeKey]) {
      console.warn(`⚠️ [Calculator] Missing AIS range for: ${rangeKey}`);
      return 5; // Fallback to mid-range
    }
    const { min, max } = aisRanges[rangeKey];

    // Check for invalid range (min >= max would cause division by zero)
    if (max <= min) {
      console.error(`❌ [Calculator] Invalid range for ${rangeKey}: min=${min}, max=${max}`);
      return 5; // Fallback to mid-range
    }

    const clamped = Math.max(min, Math.min(max, value));
    const normalized = (clamped - min) * 10 / (max - min);

    if (isNaN(normalized)) {
      console.error(`❌ [Calculator] NaN result for ${rangeKey}:`, { value, min, max, clamped });
      return 5;
    }

    return normalized;
  };

  // Calculate AIS score using the real 4-dimension system
  const calculateAisScore = (pluginsPerAgent: number): number => {
    if (!aisRanges) {
      return 2.2; // Fallback
    }

    // Estimate metrics based on plugin count (using industry best practices)
    // More plugins = more tokens, more iterations, more complexity
    const estimatedAvgTokens = 1000 + (pluginsPerAgent * 400); // 1k base + 400 per plugin
    const estimatedPeakTokens = estimatedAvgTokens * 1.5; // Peak is 50% higher
    const estimatedIterations = Math.min(3 + pluginsPerAgent, 10); // More plugins = more iterations
    const estimatedWorkflowSteps = Math.max(1, pluginsPerAgent); // At least 1 step

    // Calculate 4 dimension scores using active normalization ranges
    const tokenScore = (
      normalizeToScale(estimatedAvgTokens, 'token_volume') * 0.5 +
      normalizeToScale(estimatedPeakTokens, 'token_peak') * 0.3 +
      normalizeToScale(2.0, 'token_io_ratio_max') * 0.2 // Assume 2:1 output ratio
    );

    const executionScore = (
      normalizeToScale(estimatedIterations, 'iterations') * 0.35 +
      normalizeToScale(10000, 'duration_ms') * 0.30 + // Assume ~10s avg
      normalizeToScale(10, 'failure_rate') * 0.20 + // Assume 10% failure rate
      normalizeToScale(0.5, 'retry_rate') * 0.15 // Assume 0.5 retries avg
    );

    const pluginScore = (
      normalizeToScale(pluginsPerAgent, 'plugin_count') * 0.4 +
      normalizeToScale(pluginsPerAgent * 0.8, 'plugins_per_run') * 0.35 + // 80% used per run
      normalizeToScale(1000, 'orchestration_overhead_ms') * 0.25 // Assume 1s overhead
    );

    const workflowScore = (
      normalizeToScale(estimatedWorkflowSteps, 'workflow_steps') * 0.4 +
      normalizeToScale(Math.max(0, pluginsPerAgent - 1), 'branches') * 0.25 + // branches ~ plugins-1
      normalizeToScale(0, 'loops') * 0.20 + // Assume no loops for estimate
      normalizeToScale(0, 'parallel') * 0.15 // Assume no parallel for estimate
    );

    // Weighted average (same as real AIS system)
    const intensityScore = (
      tokenScore * 0.35 +
      executionScore * 0.25 +
      pluginScore * 0.25 +
      workflowScore * 0.15
    );

    return intensityScore;
  };

  const calculateCredits = () => {
    if (!config || !aisRanges) {
      console.warn('⚠️ [Calculator] Cannot calculate - missing config or AIS ranges');
      return;
    }

    console.log('🔢 [Calculator] Starting calculation with:', {
      config,
      inputs,
      aisRangesCount: Object.keys(aisRanges).length
    });

    const { numAgents, avgPluginsPerAgent } = inputs;

    // Calculate AIS intensity score using real 4-dimension system
    const intensityScore = calculateAisScore(avgPluginsPerAgent);
    console.log('📊 [Calculator] Intensity score:', intensityScore);

    // Convert intensity score to pricing multiplier (same as real system)
    const pricingMultiplier = 1.0 + (intensityScore / 10);
    console.log('📊 [Calculator] Pricing multiplier:', pricingMultiplier);

    // Estimate average tokens per execution based on plugin count
    const estimatedAvgTokens = 1000 + (avgPluginsPerAgent * 400);

    // Convert tokens to base Pilot Credits (÷ 10)
    const baseCreditsPerRun = Math.ceil(estimatedAvgTokens / 10);

    // Apply intensity multiplier
    const creditsPerExecution = Math.ceil(baseCreditsPerRun * pricingMultiplier);
    console.log('💳 [Calculator] Credits per execution:', creditsPerExecution);

    // Step 4: Calculate monthly execution credits (15 runs per month)
    const monthlyExecutionCredits = Math.round(
      numAgents * config.runsPerAgentPerMonth * creditsPerExecution
    );
    console.log('💳 [Calculator] Monthly execution credits:', monthlyExecutionCredits);
    console.log('📊 [Calculator] Config values:', {
      runsPerAgentPerMonth: config.runsPerAgentPerMonth,
      agentCreationCost: config.agentCreationCost,
      creditCostUsd: config.creditCostUsd,
      minimumMonthlyCostUsd: config.minimumMonthlyCostUsd
    });

    // Step 5: Add one-time creation cost per agent
    const totalCreationCost = Math.round(numAgents * config.agentCreationCost);
    console.log('💳 [Calculator] Total creation cost:', totalCreationCost);

    // Step 6: Total monthly credits (creation + execution)
    const calculatedMonthlyCredits = totalCreationCost + monthlyExecutionCredits;

    // Monthly executions for display
    const estimatedExecutions = numAgents * config.runsPerAgentPerMonth;

    // Calculate actual daily consumption based on usage pattern
    const runsPerDay = (numAgents * config.runsPerAgentPerMonth) / 30;
    const actualCreditsPerDay = Math.round(runsPerDay * creditsPerExecution);

    // Calculate cost from credits
    const calculatedCost = calculatedMonthlyCredits * config.creditCostUsd;
    console.log('💰 [Calculator] Calculated cost:', calculatedCost);

    // Apply minimum cost floor ($10 minimum)
    const monthlyAmount = Math.max(calculatedCost, config.minimumMonthlyCostUsd);

    // If we hit the minimum, back-calculate the credits needed
    const monthlyCredits = monthlyAmount === config.minimumMonthlyCostUsd
      ? Math.ceil(config.minimumMonthlyCostUsd / config.creditCostUsd)
      : calculatedMonthlyCredits;

    // Daily credits = actual consumption rate (not allocated monthly / 30)
    const creditsPerDay = actualCreditsPerDay;

    const calculationResult: CalculationResult = {
      monthlyCredits,
      monthlyAmount,
      estimatedExecutions,
      creditsPerDay,
    };

    console.log('✅ [Calculator] Final result:', calculationResult);

    setResult(calculationResult);

    if (onCalculate) {
      onCalculate(inputs, calculationResult);
    }
  };

  const updateInput = (field: keyof CalculatorInputs, value: number) => {
    setInputs((prev) => ({
      ...prev,
      [field]: Math.max(0, value),
    }));
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleSubscribe = () => {
    if (result && onSubscribe) {
      onSubscribe(result.monthlyCredits, inputs);
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="bg-zinc-900 border border-zinc-800 p-8">
          <div className="text-center">
            <div className="inline-block animate-spin h-12 w-12 border-4 border-orange-500 border-t-transparent mb-4"></div>
            <p className="text-zinc-400">Loading pricing calculator...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      {/* Main Container */}
      <div className="bg-zinc-900 border border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="bg-zinc-900/50 border-b border-zinc-800 p-6 md:p-8">
          <div className="flex items-center gap-4">
            <Zap className="w-10 h-10 md:w-12 md:h-12 text-orange-500" />
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Smart Fuel Auto-Plan</h2>
              <p className="text-zinc-400 text-sm">Calculate your monthly subscription</p>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-8">
          {/* Calculator Inputs */}
          <div className="space-y-6">
            {/* Number of Agents */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-lg md:text-xl font-semibold text-white">
                  Number of AI Agents
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={inputs.numAgents}
                    onChange={(e) => updateInput('numAgents', parseInt(e.target.value) || 0)}
                    className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 text-right font-bold text-white text-base focus:outline-none focus:border-orange-500 transition-colors"
                    min="0"
                  />
                  <span className="text-zinc-500 text-sm font-medium">agents</span>
                </div>
              </div>
              <input
                type="range"
                value={inputs.numAgents}
                onChange={(e) => updateInput('numAgents', parseInt(e.target.value))}
                min="0"
                max="50"
                step="1"
                className="w-full h-2 bg-zinc-800 appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-zinc-600 font-medium">
                <span>0</span>
                <span>25</span>
                <span>50</span>
              </div>
            </div>

            {/* Average Plugins per Agent */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-lg md:text-xl font-semibold text-white">
                  Plugins per Agent
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={inputs.avgPluginsPerAgent}
                    onChange={(e) => updateInput('avgPluginsPerAgent', parseInt(e.target.value) || 0)}
                    className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 text-right font-bold text-white text-base focus:outline-none focus:border-orange-500 transition-colors"
                    min="0"
                  />
                  <span className="text-zinc-500 text-sm font-medium">plugins</span>
                </div>
              </div>
              <input
                type="range"
                value={inputs.avgPluginsPerAgent}
                onChange={(e) => updateInput('avgPluginsPerAgent', parseInt(e.target.value))}
                min="0"
                max="10"
                step="1"
                className="w-full h-2 bg-zinc-800 appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-zinc-600 font-medium">
                <span>0</span>
                <span>5</span>
                <span>10</span>
              </div>
            </div>
          </div>

          {/* AIS Estimated Usage */}
          {result && (
            <>
              <div className="border-t border-zinc-800 pt-8 space-y-6">
                <div className="flex items-center gap-2 text-zinc-400">
                  <TrendingUp className="h-5 w-5" />
                  <h3 className="text-base font-semibold uppercase tracking-wide">AIS Estimated Usage</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-zinc-800/50 border border-zinc-700 p-6">
                    <div className="text-xs text-orange-500 mb-2 font-medium uppercase tracking-wide">Monthly Executions</div>
                    <div className="text-3xl md:text-4xl font-bold text-white">
                      {formatNumber(result.estimatedExecutions)}
                    </div>
                    <div className="text-xs text-zinc-500 mt-2">Based on typical patterns</div>
                  </div>

                  <div className="bg-zinc-800/50 border border-zinc-700 p-6">
                    <div className="text-xs text-orange-500 mb-2 font-medium uppercase tracking-wide">Daily Credits</div>
                    <div className="text-3xl md:text-4xl font-bold text-white">
                      {formatNumber(result.creditsPerDay)}
                    </div>
                    <div className="text-xs text-zinc-500 mt-2">Average consumption</div>
                  </div>
                </div>
              </div>

              {/* Monthly Subscription Cost */}
              <div className="bg-zinc-800 border border-zinc-700 p-8">
                <div className="text-center">
                  <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wide">Your Monthly Subscription</div>
                  <div className="text-5xl md:text-6xl font-bold mb-3 text-orange-500">
                    {formatCurrency(result.monthlyAmount)}
                  </div>
                  <div className="text-sm text-zinc-400">
                    {formatNumber(result.monthlyCredits)} Pilot Credits included
                  </div>
                </div>
              </div>

              {/* Features List */}
              <div className="bg-zinc-800/50 border border-zinc-800 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    'Flexible pricing',
                    '10,417 free trial credits',
                    'All plugins included',
                    'Unlimited agents',
                    'Priority support',
                    'Cancel anytime',
                  ].map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      <span className="text-sm text-zinc-300">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subscribe Button */}
              {showSubscribeButton && (
                <button
                  onClick={handleSubscribe}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold text-base transition-colors flex items-center justify-center gap-2"
                >
                  Get Started Now
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          background: #f97316;
          cursor: pointer;
          border: 2px solid #000;
          transition: all 0.2s;
        }

        .slider::-webkit-slider-thumb:hover {
          background: #ea580c;
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          background: #f97316;
          cursor: pointer;
          border: 2px solid #000;
          transition: all 0.2s;
        }

        .slider::-moz-range-thumb:hover {
          background: #ea580c;
        }
      `}</style>
    </motion.div>
  );
}
