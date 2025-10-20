'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

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
    const avgInputTokensPerExecution = 500
    const avgOutputTokensPerExecution = 300
    
    const openaiInputCost = (executionsPerMonth * avgInputTokensPerExecution / 1000000) * 0.15
    const openaiOutputCost = (executionsPerMonth * avgOutputTokensPerExecution / 1000000) * 0.60
    const totalOpenAICost = openaiInputCost + openaiOutputCost
    
    const llmCostToUser = totalOpenAICost * 5
    const pluginCost = pluginCount * 1
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
      buttonStyle: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white',
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
      buttonStyle: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white',
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
      buttonStyle: 'bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white',
      popular: false
    }
  ]

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Background Effects - Same as main page */}
      <div className="fixed inset-0 pointer-events-none">
        <motion.div
          animate={{
            backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-blue-900/40 via-purple-900/30 to-pink-900/40 bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            backgroundPosition: ['100% 100%', '0% 0%', '100% 100%'],
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-indigo-900/30 via-transparent to-fuchsia-900/30 bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            x: [0, 150, 0],
            y: [0, -150, 0],
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-20 left-20 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -150, 0],
            y: [0, 150, 0],
            scale: [1, 1.4, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, 100, -100, 0],
            y: [0, -100, 100, 0],
            scale: [1, 1.2, 1.3, 1],
            opacity: [0.2, 0.4, 0.3, 0.2]
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/15 rounded-full blur-3xl"
        />
      </div>

      <div className="relative z-10">
        {/* Header Section */}
        <section className="relative z-10 pt-20 pb-32">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center"
            >
              <motion.h1 
                className="text-5xl md:text-7xl font-black mb-6 leading-tight"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
              >
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Simple, Transparent
                </span>
                <br />
                <span className="text-white">AI Pricing</span>
              </motion.h1>
              
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-xl md:text-2xl text-slate-300 max-w-4xl mx-auto mb-8 leading-relaxed"
              >
                Pay only for what you use. Real OpenAI API costs with transparent markup,
                <br />
                plus simple $1 per plugin and $2 per agent pricing.
              </motion.p>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex items-center justify-center gap-6 text-sm text-slate-400"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span>No hidden fees</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                  <span>Cancel anytime</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                  <span>7-day free trial</span>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Cost Calculator Section */}
        <section className="relative z-10 py-32">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-20"
            >
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Calculate Your Real Costs
                </span>
              </h2>
              <p className="text-xl text-slate-400 max-w-2xl mx-auto">
                See exactly what you'll pay based on actual usage
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative group"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
              
              <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl border border-white/20">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Controls */}
                  <div className="space-y-8">
                    <div>
                      <label className="block text-white font-semibold mb-4 text-lg">
                        Number of AI Agents: {agentCount}
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="50"
                        value={agentCount}
                        onChange={(e) => setAgentCount(parseInt(e.target.value))}
                        className="w-full h-3 bg-purple-800/50 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div className="flex justify-between text-sm text-gray-300 mt-2">
                        <span>1 agent</span>
                        <span>50+ agents</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-white font-semibold mb-4 text-lg">
                        Plugin Integrations: {pluginCount}
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={pluginCount}
                        onChange={(e) => setPluginCount(parseInt(e.target.value))}
                        className="w-full h-3 bg-purple-800/50 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div className="flex justify-between text-sm text-gray-300 mt-2">
                        <span>1 plugin</span>
                        <span>20+ plugins</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-white font-semibold mb-4 text-lg">
                        Monthly AI Calls: {executionsPerMonth.toLocaleString()}
                      </label>
                      <input
                        type="range"
                        min="1000"
                        max="500000"
                        step="5000"
                        value={executionsPerMonth}
                        onChange={(e) => setExecutionsPerMonth(parseInt(e.target.value))}
                        className="w-full h-3 bg-purple-800/50 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div className="flex justify-between text-sm text-gray-300 mt-2">
                        <span>1K</span>
                        <span>500K+</span>
                      </div>
                    </div>

                    <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-500/30">
                      <div className="text-sm text-blue-200 font-medium mb-2">Calculation Details:</div>
                      <div className="text-xs text-blue-300 space-y-1">
                        <div>• Average: {costs.avgTokensPerExecution} tokens per AI call</div>
                        <div>• OpenAI cost: ${costs.openaiCost.toFixed(4)}/month</div>
                        <div>• Our markup: 5x (industry standard)</div>
                      </div>
                    </div>
                  </div>

                  {/* Results */}
                  <div className="bg-gradient-to-br from-blue-900/50 to-purple-900/50 rounded-2xl p-8 border border-blue-400/30">
                    <h3 className="text-2xl font-bold text-white mb-6">Monthly Cost Breakdown</h3>
                    
                    <div className="space-y-4 mb-6">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-200">AI API Usage ({executionsPerMonth.toLocaleString()} calls)</span>
                        <span className="font-semibold text-white">${costs.llmCostToUser.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-200">Plugin Subscriptions ({pluginCount} × $1)</span>
                        <span className="font-semibold text-white">${costs.pluginCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-200">Agent Management ({agentCount} × $2)</span>
                        <span className="font-semibold text-white">${costs.agentCost.toFixed(2)}</span>
                      </div>
                      <div className="border-t border-purple-500/30 pt-4">
                        <div className="flex justify-between items-center">
                          <span className="text-lg font-bold text-white">Total Monthly Cost</span>
                          <span className="text-2xl font-bold bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                            ${totalMonthlyCost.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-purple-800/30 rounded-lg p-4 border border-purple-400/30">
                      <div className="text-sm text-gray-200 mb-2">Recommended Plan:</div>
                      <div className="text-xl font-bold text-blue-300 capitalize">
                        {getRecommendedPlan()}
                      </div>
                      <div className="text-sm text-gray-300 mt-1">
                        {getRecommendedPlan() === 'starter' && 'Perfect for getting started'}
                        {getRecommendedPlan() === 'professional' && 'Great for growing businesses'}
                        {getRecommendedPlan() === 'enterprise' && 'Built for scale and performance'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Pricing Cards Section */}
        <section id="pricing" className="relative z-10 py-32">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-20"
            >
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Choose Your Plan
                </span>
              </h2>
              <p className="text-xl text-slate-400 max-w-2xl mx-auto">
                Start with our free trial and scale as your automation needs grow
              </p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {pricingPlans.map((plan, index) => (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.2 }}
                  className="group relative"
                >
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500" />
                  <div className={`relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl hover:shadow-purple-500/25 transition-all duration-300 ${
                    plan.popular ? 'scale-105 border-purple-400/50' : ''
                  }`}>
                    {plan.popular && (
                      <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                        <span className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-2 rounded-full text-sm font-semibold shadow-lg">
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
                        <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                        <p className="text-slate-400 mb-6">{plan.description}</p>
                        
                        <div className="mb-4">
                          <div className="flex items-center justify-center">
                            <span className="text-5xl font-black text-white">${plan.price}</span>
                            <span className="text-lg text-slate-400 ml-2">/{plan.period}</span>
                          </div>
                          {plan.trialNote && (
                            <p className="text-sm text-slate-400 mt-2">{plan.trialNote}</p>
                          )}
                        </div>

                        <div className="inline-flex items-center px-4 py-2 bg-blue-500/20 rounded-full border border-blue-400/40 mb-6">
                          <span className="text-sm font-semibold text-blue-200">
                            {plan.credits}
                          </span>
                        </div>
                      </div>

                      <ul className="space-y-4 mb-8">
                        {plan.features.map((feature, index) => (
                          <li key={index} className="flex items-center">
                            <svg className="w-5 h-5 text-green-400 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-slate-300">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      <button className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 hover:scale-105 shadow-lg ${plan.buttonStyle}`}>
                        {plan.buttonText}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Enterprise Notice */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="mt-16 text-center"
            >
              <div className="relative group max-w-4xl mx-auto">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
                <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 border border-white/20 text-center">
                  <h3 className="text-2xl font-bold text-white mb-4">Need More Than Enterprise?</h3>
                  <p className="text-slate-300 mb-6 max-w-2xl mx-auto">
                    For organizations with custom requirements, volume discounts, or special security needs, 
                    we offer tailored solutions with dedicated support.
                  </p>
                  <button className="bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-800 hover:to-black text-white px-8 py-4 rounded-xl font-semibold transition-all duration-300 hover:scale-105 shadow-lg">
                    Contact Sales
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="relative z-10 py-32">
          <div className="max-w-4xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-20"
            >
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Frequently Asked Questions
                </span>
              </h2>
            </motion.div>

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
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-xl rounded-2xl p-8 border border-white/10 hover:border-white/20 transition"
                >
                  <h3 className="text-xl font-bold mb-3 text-white">{faq.question}</h3>
                  <p className="text-slate-400 leading-relaxed">{faq.answer}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          cursor: pointer;
          border: none;
          box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
        }
      `}</style>
    </div>
  )
}