'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Code, Zap, DollarSign, Clock, TrendingDown, ArrowRight, Users, Server, Wrench } from 'lucide-react';

interface CalculatorInputs {
  numAgents: number;
  avgPluginsPerAgent: number;
}

interface ComparisonResult {
  traditional: {
    developmentCost: number;
    developmentTime: number;
    monthlyMaintenance: number;
    firstYearTotal: number;
    threeYearTotal: number;
  };
  agentsPilot: {
    monthlySubscription: number;
    setupTime: number;
    firstYearTotal: number;
    threeYearTotal: number;
  };
  savings: {
    firstYear: number;
    firstYearPercent: number;
    threeYear: number;
    threeYearPercent: number;
    timeSaved: number;
  };
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
}

export default function DevelopmentVsAgentsPilotCalculator() {
  const [inputs, setInputs] = useState<CalculatorInputs>({
    numAgents: 3,
    avgPluginsPerAgent: 3,
  });

  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [aisRanges, setAisRanges] = useState<Record<string, { min: number; max: number }> | null>(null);
  const [loading, setLoading] = useState(true);

  // Traditional development cost assumptions
  const DEVELOPER_HOURLY_RATE = 150; // Average senior developer rate
  const HOURS_PER_AGENT = 80; // Development time per agent
  const HOURS_PER_PLUGIN = 40; // Development time per plugin integration
  const MONTHLY_MAINTENANCE_PER_AGENT = 500; // Ongoing maintenance costs
  const SETUP_TIME_HOURS = 2; // AgentsPilot setup time per agent

  // Fetch pricing configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [configResponse, aisResponse] = await Promise.all([
          fetch('/api/pricing/config'),
          fetch('/api/pricing/ais-ranges')
        ]);

        const configData = await configResponse.json();
        const aisData = await aisResponse.json();

        if (configData.success) {
          setConfig(configData.config);
        }

        if (aisData.success) {
          setAisRanges(aisData.ranges);
        }
      } catch (error) {
        console.error('Error fetching pricing data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  // Calculate comparison whenever inputs change
  useEffect(() => {
    if (config && aisRanges) {
      calculateComparison();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, config, aisRanges]);

  const normalizeToScale = (value: number, rangeKey: string): number => {
    if (!aisRanges || !aisRanges[rangeKey]) {
      return 5;
    }
    const { min, max } = aisRanges[rangeKey];

    if (max <= min) {
      return 5;
    }

    const clamped = Math.max(min, Math.min(max, value));
    const normalized = (clamped - min) * 10 / (max - min);

    if (isNaN(normalized)) {
      return 5;
    }

    return normalized;
  };

  const calculateAisScore = (pluginsPerAgent: number): number => {
    if (!aisRanges) {
      return 2.2;
    }

    const estimatedAvgTokens = 1000 + (pluginsPerAgent * 400);
    const estimatedPeakTokens = estimatedAvgTokens * 1.5;
    const estimatedIterations = Math.min(3 + pluginsPerAgent, 10);
    const estimatedWorkflowSteps = Math.max(1, pluginsPerAgent);

    const tokenScore = (
      normalizeToScale(estimatedAvgTokens, 'token_volume') * 0.5 +
      normalizeToScale(estimatedPeakTokens, 'token_peak') * 0.3 +
      normalizeToScale(2.0, 'token_io_ratio_max') * 0.2
    );

    const executionScore = (
      normalizeToScale(estimatedIterations, 'iterations') * 0.35 +
      normalizeToScale(10000, 'duration_ms') * 0.30 +
      normalizeToScale(10, 'failure_rate') * 0.20 +
      normalizeToScale(0.5, 'retry_rate') * 0.15
    );

    const pluginScore = (
      normalizeToScale(pluginsPerAgent, 'plugin_count') * 0.4 +
      normalizeToScale(pluginsPerAgent * 0.8, 'plugins_per_run') * 0.35 +
      normalizeToScale(1000, 'orchestration_overhead_ms') * 0.25
    );

    const workflowScore = (
      normalizeToScale(estimatedWorkflowSteps, 'workflow_steps') * 0.4 +
      normalizeToScale(Math.max(0, pluginsPerAgent - 1), 'branches') * 0.25 +
      normalizeToScale(0, 'loops') * 0.20 +
      normalizeToScale(0, 'parallel') * 0.15
    );

    const intensityScore = (
      tokenScore * 0.35 +
      executionScore * 0.25 +
      pluginScore * 0.25 +
      workflowScore * 0.15
    );

    return intensityScore;
  };

  const calculateComparison = () => {
    if (!config || !aisRanges) {
      return;
    }

    const { numAgents, avgPluginsPerAgent } = inputs;

    // Traditional Development Costs
    const agentDevelopmentHours = numAgents * HOURS_PER_AGENT;
    const pluginDevelopmentHours = numAgents * avgPluginsPerAgent * HOURS_PER_PLUGIN;
    const totalDevelopmentHours = agentDevelopmentHours + pluginDevelopmentHours;
    const developmentCost = totalDevelopmentHours * DEVELOPER_HOURLY_RATE;
    const developmentTime = Math.ceil(totalDevelopmentHours / 40); // Convert to weeks (40hr work week)
    const monthlyMaintenance = numAgents * MONTHLY_MAINTENANCE_PER_AGENT;
    const traditionalFirstYear = developmentCost + (monthlyMaintenance * 12);
    const traditionalThreeYear = developmentCost + (monthlyMaintenance * 36);

    // AgentsPilot Costs
    const intensityScore = calculateAisScore(avgPluginsPerAgent);
    const pricingMultiplier = 1.0 + (intensityScore / 10);
    const estimatedAvgTokens = 1000 + (avgPluginsPerAgent * 400);
    const baseCreditsPerRun = Math.ceil(estimatedAvgTokens / 10);
    const creditsPerExecution = Math.ceil(baseCreditsPerRun * pricingMultiplier);
    const monthlyExecutionCredits = Math.round(
      numAgents * config.runsPerAgentPerMonth * creditsPerExecution
    );
    const totalCreationCost = Math.round(numAgents * config.agentCreationCost);
    const calculatedMonthlyCredits = totalCreationCost + monthlyExecutionCredits;
    const calculatedCost = calculatedMonthlyCredits * config.creditCostUsd;
    const monthlyAmount = Math.max(calculatedCost, config.minimumMonthlyCostUsd);

    const agentsPilotFirstYear = monthlyAmount * 12;
    const agentsPilotThreeYear = monthlyAmount * 36;
    const setupTimeHours = numAgents * SETUP_TIME_HOURS;

    // Calculate Savings
    const firstYearSavings = traditionalFirstYear - agentsPilotFirstYear;
    const firstYearPercent = (firstYearSavings / traditionalFirstYear) * 100;
    const threeYearSavings = traditionalThreeYear - agentsPilotThreeYear;
    const threeYearPercent = (threeYearSavings / traditionalThreeYear) * 100;
    const timeSavedHours = totalDevelopmentHours - setupTimeHours;

    const comparisonResult: ComparisonResult = {
      traditional: {
        developmentCost,
        developmentTime,
        monthlyMaintenance,
        firstYearTotal: traditionalFirstYear,
        threeYearTotal: traditionalThreeYear,
      },
      agentsPilot: {
        monthlySubscription: monthlyAmount,
        setupTime: Math.ceil(setupTimeHours / 8), // Convert to days
        firstYearTotal: agentsPilotFirstYear,
        threeYearTotal: agentsPilotThreeYear,
      },
      savings: {
        firstYear: firstYearSavings,
        firstYearPercent,
        threeYear: threeYearSavings,
        threeYearPercent,
        timeSaved: timeSavedHours,
      }
    };

    setResult(comparisonResult);
  };

  const updateInput = (field: keyof CalculatorInputs, value: number) => {
    setInputs((prev) => ({
      ...prev,
      [field]: Math.max(0, value),
    }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 p-8">
        <div className="text-center">
          <div className="inline-block animate-spin h-12 w-12 border-4 border-orange-500 border-t-transparent mb-4"></div>
          <p className="text-zinc-400">Loading cost calculator...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Calculator Inputs */}
      <div className="bg-zinc-900 border border-zinc-800 p-6 md:p-8">
        <h3 className="text-xl md:text-2xl font-bold text-white mb-6">Configure Your Scenario</h3>

        <div className="space-y-6">
          {/* Number of Agents */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-base md:text-lg font-semibold text-white">
                Number of Automation Tasks
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={inputs.numAgents}
                  onChange={(e) => updateInput('numAgents', parseInt(e.target.value) || 0)}
                  className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 text-right font-bold text-white text-base focus:outline-none focus:border-orange-500 transition-colors"
                  min="0"
                />
                <span className="text-zinc-500 text-sm font-medium">tasks</span>
              </div>
            </div>
            <input
              type="range"
              value={inputs.numAgents}
              onChange={(e) => updateInput('numAgents', parseInt(e.target.value))}
              min="1"
              max="20"
              step="1"
              className="w-full h-2 bg-zinc-800 appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-zinc-600 font-medium">
              <span>1</span>
              <span>10</span>
              <span>20</span>
            </div>
          </div>

          {/* Plugins per Agent */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-base md:text-lg font-semibold text-white">
                Integrations per Task
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={inputs.avgPluginsPerAgent}
                  onChange={(e) => updateInput('avgPluginsPerAgent', parseInt(e.target.value) || 0)}
                  className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 text-right font-bold text-white text-base focus:outline-none focus:border-orange-500 transition-colors"
                  min="0"
                />
                <span className="text-zinc-500 text-sm font-medium">integrations</span>
              </div>
            </div>
            <input
              type="range"
              value={inputs.avgPluginsPerAgent}
              onChange={(e) => updateInput('avgPluginsPerAgent', parseInt(e.target.value))}
              min="1"
              max="10"
              step="1"
              className="w-full h-2 bg-zinc-800 appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-zinc-600 font-medium">
              <span>1</span>
              <span>5</span>
              <span>10</span>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Results */}
      {result && (
        <>
          {/* Side-by-side Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Traditional Development */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="bg-zinc-900/50 border border-zinc-800 p-6 md:p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <Code className="w-8 h-8 text-zinc-500" />
                <h3 className="text-xl font-bold text-zinc-400">Traditional Development</h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
                  <DollarSign className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="text-sm text-zinc-500 mb-1">Initial Development</div>
                    <div className="text-2xl font-bold text-white">{formatCurrency(result.traditional.developmentCost)}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
                  <Clock className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="text-sm text-zinc-500 mb-1">Development Time</div>
                    <div className="text-2xl font-bold text-white">{result.traditional.developmentTime} weeks</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
                  <Wrench className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="text-sm text-zinc-500 mb-1">Monthly Maintenance</div>
                    <div className="text-2xl font-bold text-white">{formatCurrency(result.traditional.monthlyMaintenance)}</div>
                  </div>
                </div>

                <div className="bg-zinc-800/50 p-4 mt-6">
                  <div className="text-xs text-zinc-500 mb-1">First Year Total</div>
                  <div className="text-3xl font-bold text-red-400">{formatCurrency(result.traditional.firstYearTotal)}</div>
                </div>

                <div className="bg-zinc-800/30 p-4">
                  <div className="text-xs text-zinc-500 mb-1">Three Year Total</div>
                  <div className="text-xl font-bold text-zinc-400">{formatCurrency(result.traditional.threeYearTotal)}</div>
                </div>
              </div>
            </motion.div>

            {/* AgentsPilot */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="bg-zinc-900/50 border border-orange-500/30 p-6 md:p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <Zap className="w-8 h-8 text-orange-500" />
                <h3 className="text-xl font-bold text-orange-500">AgentsPilot</h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
                  <DollarSign className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="text-sm text-zinc-500 mb-1">Monthly Subscription</div>
                    <div className="text-2xl font-bold text-white">{formatCurrency(result.agentsPilot.monthlySubscription)}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
                  <Clock className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="text-sm text-zinc-500 mb-1">Setup Time</div>
                    <div className="text-2xl font-bold text-white">{result.agentsPilot.setupTime} days</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
                  <Wrench className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
                  <div className="flex-1">
                    <div className="text-sm text-zinc-500 mb-1">Maintenance</div>
                    <div className="text-2xl font-bold text-green-400">Included</div>
                  </div>
                </div>

                <div className="bg-orange-500/10 border border-orange-500/30 p-4 mt-6">
                  <div className="text-xs text-orange-500 mb-1">First Year Total</div>
                  <div className="text-3xl font-bold text-orange-500">{formatCurrency(result.agentsPilot.firstYearTotal)}</div>
                </div>

                <div className="bg-orange-500/5 border border-orange-500/20 p-4">
                  <div className="text-xs text-orange-500/70 mb-1">Three Year Total</div>
                  <div className="text-xl font-bold text-orange-500/90">{formatCurrency(result.agentsPilot.threeYearTotal)}</div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Savings Highlight */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="bg-gradient-to-r from-green-500/10 to-orange-500/10 border border-green-500/30 p-6 md:p-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <TrendingDown className="w-10 h-10 text-green-400" />
              <h3 className="text-2xl md:text-3xl font-bold text-white">Your Savings with AgentsPilot</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-zinc-900/80 p-6">
                <div className="text-sm text-green-400 mb-2 font-medium">First Year Savings</div>
                <div className="text-4xl font-bold text-green-400 mb-2">{formatCurrency(result.savings.firstYear)}</div>
                <div className="text-xl text-green-300">{result.savings.firstYearPercent.toFixed(0)}% less</div>
              </div>

              <div className="bg-zinc-900/80 p-6">
                <div className="text-sm text-green-400 mb-2 font-medium">Three Year Savings</div>
                <div className="text-4xl font-bold text-green-400 mb-2">{formatCurrency(result.savings.threeYear)}</div>
                <div className="text-xl text-green-300">{result.savings.threeYearPercent.toFixed(0)}% less</div>
              </div>

              <div className="bg-zinc-900/80 p-6">
                <div className="text-sm text-green-400 mb-2 font-medium">Time Saved</div>
                <div className="text-4xl font-bold text-green-400 mb-2">{formatNumber(result.savings.timeSaved)}</div>
                <div className="text-xl text-green-300">hours</div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-zinc-800">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <p className="text-zinc-300 text-lg">
                  With AgentsPilot, you get started in days instead of months, and save significantly on development and maintenance costs.
                </p>
                <button className="px-8 py-4 bg-orange-500 hover:bg-orange-600 font-semibold transition-colors flex items-center gap-2 whitespace-nowrap">
                  Get Started Now
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}

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
    </div>
  );
}
