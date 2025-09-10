'use client'

import { useState, useEffect } from 'react'

export default function PricingPage() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [agentCount, setAgentCount] = useState(5)
  const [pluginCount, setPluginCount] = useState(3)
  const [executionsPerMonth, setExecutionsPerMonth] = useState(10000)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    setIsVisible(true)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Real OpenAI API cost calculation with 5x markup
  const calculateCosts = () => {
    // Current OpenAI GPT-4o-mini pricing (January 2025):
    // Input: $0.15 per 1M tokens, Output: $0.60 per 1M tokens
    // Average execution: ~500 input tokens + ~300 output tokens = 800 tokens total
    
    const avgInputTokensPerExecution = 500
    const avgOutputTokensPerExecution = 300
    
    // OpenAI costs (what you pay)
    const openaiInputCost = (executionsPerMonth * avgInputTokensPerExecution / 1000000) * 0.15
    const openaiOutputCost = (executionsPerMonth * avgOutputTokensPerExecution / 1000000) * 0.60
    const totalOpenAICost = openaiInputCost + openaiOutputCost
    
    // Your markup: 5x OpenAI costs
    const llmCostToUser = totalOpenAICost * 5
    
    // Plugin costs - $1 per plugin per month (your pricing)
    const pluginCost = pluginCount * 1
    
    // Agent hosting/management - $2 per agent per month (your pricing)
    const agentCost = agentCount * 2
    
    const totalMonthlyCost = llmCostToUser + pluginCost + agentCost
    
    return {
      openaiCost: totalOpenAICost,
      llmCostToUser: llmCostToUser,
      pluginCost: pluginCost,
      agentCost: agentCost,
      totalMonthlyCost: totalMonthlyCost,
      avgTokensPerExecution: avgInputTokensPerExecution + avgOutputTokensPerExecution
    }
  }

  const costs = calculateCosts()
  const totalMonthlyCost = costs.totalMonthlyCost

  const getRecommendedPlan = () => {
    if (totalMonthlyCost <= 20) return 'starter'
    if (totalMonthlyCost <= 49) return 'professional'
    return 'enterprise'
  }

  const pricingPlans = [
    {
      id: 'starter',
      name: 'Starter',
      price: 20,
      period: 'month',
      description: 'Perfect for exploring AI automation',
      credits: 'Up to $20/month usage',
      features: [
        'Up to 5 AI agents',
        '3 plugin integrations',
        '~20,000 monthly AI calls',
        'Email support',
        'Basic templates',
        'Standard security'
      ],
      buttonText: 'Start Free Trial',
      buttonStyle: 'bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white',
      popular: false,
      trialNote: '7-day free trial, then $20/month'
    },
    {
      id: 'professional',
      name: 'Professional',
      price: 49,
      period: 'month',
      description: 'For professionals with regular automation needs',
      credits: 'Up to $49/month usage',
      features: [
        'Up to 25 AI agents',
        '10 plugin integrations',
        '~100,000 monthly AI calls',
        'Priority support',
        'Advanced templates',
        'Enhanced security',
        'Custom workflows',
        'API access'
      ],
      buttonText: 'Choose Professional',
      buttonStyle: 'bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white',
      popular: true
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 89,
      period: 'month',
      description: 'For power users with intensive automation workflows',
      credits: 'Up to $89/month usage',
      features: [
        'Unlimited AI agents',
        'Unlimited plugin integrations',
        '~200,000+ monthly AI calls',
        'Dedicated support',
        'Premium templates',
        'Enterprise security',
        'Custom integrations',
        'Advanced analytics',
        'SLA guarantee',
        'On-premise deployment'
      ],
      buttonText: 'Choose Enterprise',
      buttonStyle: 'bg-gradient-to-r from-purple-600 to-pink-700 hover:from-purple-700 hover:to-pink-800 text-white',
      popular: false
    }
  ]

  return (
    <div className="min-h-screen bg-white text-gray-900 relative overflow-hidden">
      {/* Subtle AI Grid Background */}
      <div className="fixed inset-0 z-0">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59, 130, 246, 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59, 130, 246, 0.08) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
            animation: 'gridMove 20s linear infinite'
          }}
        />
      </div>

      {/* Subtle Interactive Mouse Glow */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none transition-all duration-300"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(59, 130, 246, 0.04), transparent 50%)`
        }}
      />

      <div className="relative z-10">
        {/* Header Section */}
        <section className="py-20 relative">
          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
            <div className={`transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
              <div className="inline-flex items-center px-6 py-3 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 backdrop-blur-sm mb-8 shadow-lg">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-3 animate-pulse" />
                <span className="text-sm font-medium text-blue-700">Transparent Pricing • No Hidden Fees</span>
              </div>

              <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                <span className="block text-gray-900 mb-2">Simple</span>
                <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  AI Usage
                </span>
                <span className="block text-gray-900">Pricing</span>
              </h1>

              <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-3xl mx-auto leading-relaxed">
                Pay only for what you use. Real OpenAI API costs, $1 per plugin, transparent pricing.
              </p>
            </div>
          </div>
        </section>

        {/* Cost Calculator Section */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Calculate Your Real Costs
                </span>
              </h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                See exactly what you'll pay based on actual OpenAI API usage and plugin costs
              </p>
            </div>

            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-8 border border-gray-200 shadow-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Controls */}
                <div className="space-y-8">
                  <div>
                    <label className="block text-gray-900 font-semibold mb-4 text-lg">
                      Number of AI Agents: {agentCount}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={agentCount}
                      onChange={(e) => setAgentCount(parseInt(e.target.value))}
                      className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-sm text-gray-500 mt-2">
                      <span>1 agent</span>
                      <span>50+ agents</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-gray-900 font-semibold mb-4 text-lg">
                      Plugin Integrations: {pluginCount}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={pluginCount}
                      onChange={(e) => setPluginCount(parseInt(e.target.value))}
                      className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-sm text-gray-500 mt-2">
                      <span>1 plugin</span>
                      <span>20+ plugins</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-gray-900 font-semibold mb-4 text-lg">
                      Monthly AI Calls: {executionsPerMonth.toLocaleString()}
                    </label>
                    <input
                      type="range"
                      min="1000"
                      max="500000"
                      step="5000"
                      value={executionsPerMonth}
                      onChange={(e) => setExecutionsPerMonth(parseInt(e.target.value))}
                      className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-sm text-gray-500 mt-2">
                      <span>1K</span>
                      <span>500K+</span>
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <div className="text-sm text-blue-800 font-medium mb-2">Calculation Details:</div>
                    <div className="text-xs text-blue-600 space-y-1">
                      <div>• Average: {costs.avgTokensPerExecution} tokens per AI call</div>
                      <div>• OpenAI cost: ${costs.openaiCost.toFixed(4)}/month</div>
                      <div>• Our markup: 5x (industry standard)</div>
                    </div>
                  </div>
                </div>

                {/* Results */}
                <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-8 border border-blue-200">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Monthly Cost Breakdown</h3>
                  
                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">AI API Usage ({executionsPerMonth.toLocaleString()} calls)</span>
                      <span className="font-semibold text-gray-900">${costs.llmCostToUser.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Plugin Subscriptions ({pluginCount} × $1)</span>
                      <span className="font-semibold text-gray-900">${costs.pluginCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Agent Management ({agentCount} × $2)</span>
                      <span className="font-semibold text-gray-900">${costs.agentCost.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-gray-300 pt-4">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-900">Total Monthly Cost</span>
                        <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                          ${totalMonthlyCost.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/80 rounded-lg p-4 border border-blue-200">
                    <div className="text-sm text-gray-600 mb-2">Recommended Plan:</div>
                    <div className="text-xl font-bold text-blue-700 capitalize">
                      {getRecommendedPlan()}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {getRecommendedPlan() === 'starter' && 'Perfect for getting started'}
                      {getRecommendedPlan() === 'professional' && 'Great for growing businesses'}
                      {getRecommendedPlan() === 'enterprise' && 'Built for scale and performance'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Cards Section */}
        <section className="py-20 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Choose Your Plan
                </span>
              </h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Start with our free trial and scale as your automation needs grow
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {pricingPlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`relative bg-white/90 backdrop-blur-sm rounded-2xl border shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 ${
                    plan.popular 
                      ? 'border-blue-400 shadow-blue-100' 
                      : 'border-gray-200'
                  } ${
                    getRecommendedPlan() === plan.id
                      ? 'ring-2 ring-blue-400 ring-opacity-50'
                      : ''
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                      <span className="bg-gradient-to-r from-blue-600 to-purple-700 text-white px-6 py-2 rounded-full text-sm font-semibold shadow-lg">
                        Most Popular
                      </span>
                    </div>
                  )}

                  {getRecommendedPlan() === plan.id && (
                    <div className="absolute -top-4 right-4">
                      <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                        Recommended
                      </span>
                    </div>
                  )}

                  <div className="p-8">
                    <div className="text-center mb-8">
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                      <p className="text-gray-600 mb-6">{plan.description}</p>
                      
                      <div className="mb-4">
                        <div className="flex items-center justify-center">
                          <span className="text-5xl font-black text-gray-900">${plan.price}</span>
                          <span className="text-lg text-gray-500 ml-2">/{plan.period}</span>
                        </div>
                        {plan.trialNote && (
                          <p className="text-sm text-gray-500 mt-2">{plan.trialNote}</p>
                        )}
                      </div>

                      <div className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-blue-50 to-purple-50 rounded-full border border-blue-200 mb-6">
                        <span className="text-sm font-semibold text-blue-700">
                          {plan.credits}
                        </span>
                      </div>
                    </div>

                    <ul className="space-y-4 mb-8">
                      {plan.features.map((feature, index) => (
                        <li key={index} className="flex items-center">
                          <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-gray-600">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <button className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 hover:scale-105 shadow-lg ${plan.buttonStyle}`}>
                      {plan.buttonText}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Enterprise Notice */}
            <div className="mt-16 text-center">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 shadow-lg max-w-3xl mx-auto">
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Need More Than Enterprise?</h3>
                <p className="text-gray-600 mb-6">
                  For organizations with custom requirements, volume discounts, or special security needs, 
                  we offer tailored solutions with dedicated support.
                </p>
                <button className="bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-800 hover:to-black text-white px-8 py-4 rounded-xl font-semibold transition-all duration-300 hover:scale-105 shadow-lg">
                  Contact Sales
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 relative bg-gradient-to-b from-white to-gray-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Frequently Asked Questions
              </h2>
            </div>

            <div className="space-y-6">
              {[
                {
                  question: "How does the AI pricing work?",
                  answer: "We use real OpenAI GPT-4o-mini API pricing ($0.15 input + $0.60 output per 1M tokens) with a 5x markup to cover our infrastructure, support, and profit. Average AI call uses ~800 tokens. Plugins are $1/month each, agents are $2/month each for hosting."
                },
                {
                  question: "Why the 5x markup on OpenAI costs?",
                  answer: "The 5x markup covers our infrastructure costs, 24/7 support, reliability guarantees, security measures, and development costs. This is industry standard for AI API resellers and ensures sustainable service quality."
                },
                {
                  question: "Can I change plans anytime?",
                  answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and billing is prorated."
                },
                {
                  question: "What happens if I exceed my plan limit?",
                  answer: "Your agents will pause when the monthly limit is reached. You can upgrade your plan or purchase additional usage credits to resume operation immediately."
                }
              ].map((faq, index) => (
                <div key={index} className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-gray-200 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">{faq.question}</h3>
                  <p className="text-gray-600">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        @keyframes gridMove {
          0% { background-position: 0 0; }
          100% { background-position: 50px 50px; }
        }

        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          cursor: pointer;
          border: none;
          box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
        }
      `}</style>
    </div>
  )
}