'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import PilotCreditCalculator from '@/components/billing/PilotCreditCalculator'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function PricingPage() {
  const router = useRouter()

  const handleSubscribe = async (monthlyCredits: number, inputs: any) => {
    try {
      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        // Not authenticated - redirect to signup page
        // Pass calculator inputs as URL params so they can pre-fill after signup
        router.push(`/signup?credits=${monthlyCredits}&agents=${inputs.numAgents}&plugins=${inputs.avgPluginsPerAgent}`)
        return
      }

      // User is authenticated - create Stripe subscription
      console.log('Creating subscription for authenticated user:', user.id)

      const response = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyCredits,
          calculatorInputs: inputs
        })
      })

      const data = await response.json()

      if (data.success) {
        // Subscription created successfully
        // Redirect to Stripe checkout or dashboard
        if (data.checkoutUrl) {
          console.log('Redirecting to Stripe checkout:', data.checkoutUrl)
          window.location.href = data.checkoutUrl
        } else {
          // No checkout needed (maybe updating existing subscription)
          console.log('Subscription updated, redirecting to dashboard')
          router.push('/dashboard?subscription=updated')
        }
      } else {
        throw new Error(data.error || 'Failed to create subscription')
      }
    } catch (error) {
      console.error('Subscription error:', error)
      alert('Failed to start subscription. Please try again or contact support.')
    }
  }

  const faqs = [
    {
      question: "How does the Smart Fuel Auto-Plan work?",
      answer: "Simply tell us how many agents and plugins you plan to use. Our AIS (AI System) estimates your usage based on typical patterns and calculates your monthly Pilot Credit needs. Your subscription adjusts automatically based on your selections."
    },
    {
      question: "What are Pilot Credits?",
      answer: "Pilot Credits are our branded pricing currency for tracking AI automation usage. They represent the computational resources your agents consume. The more agents and plugins you use, the more Pilot Credits you'll need each month."
    },
    {
      question: "Do unused Pilot Credits expire?",
      answer: "No! Your Pilot Credits roll over indefinitely as long as your account remains active. We believe in fair pricing - you shouldn't lose what you've paid for."
    },
    {
      question: "What happens if I run out of Pilot Credits?",
      answer: "Your agents will automatically pause when your Pilot Credit balance reaches zero. You'll receive an alert 24 hours before this happens. You can purchase a Boost Pack for instant Pilot Credits or wait for your monthly renewal."
    },
    {
      question: "Can I change my subscription anytime?",
      answer: "Absolutely! Just adjust the calculator sliders and update your subscription. Changes are prorated automatically. Scale up or down as your automation needs change."
    },
    {
      question: "What are Boost Packs?",
      answer: "Boost Packs are one-time Pilot Credit purchases for when you need extra credits mid-month. Perfect for unexpected workload spikes, testing new agents, or seasonal demand increases."
    },
    {
      question: "What is AIS Estimated Usage?",
      answer: "AIS (AI System) analyzes historical data from thousands of agent executions to estimate how often agents typically run. Based on your agent and plugin configuration, AIS predicts your monthly Pilot Credit consumption."
    },
    {
      question: "Is there a free trial?",
      answer: "Yes! Every new user gets 1,000 free Pilot Credits to explore the platform. That's enough for hundreds of agent executions. No credit card required to start building."
    }
  ]

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Background Effects */}
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
        <section className="relative z-10 pt-20 pb-16">
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
                  Pay Only for
                </span>
                <br />
                <span className="text-white">What You Use</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-xl md:text-2xl text-slate-300 max-w-4xl mx-auto mb-8 leading-relaxed"
              >
                Smart Fuel Auto-Plan: Calculate your exact needs. No fixed tiers.
                <br />
                Pilot Credits roll over forever. Pay only for what you use.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex items-center justify-center gap-6 text-sm text-slate-400"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span>Credits never expire</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                  <span>Cancel anytime</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                  <span>1,000 free trial credits</span>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Calculator Section */}
        <section className="relative z-10 py-16">
          <div className="max-w-4xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <PilotCreditCalculator
                showSubscribeButton={true}
                onSubscribe={handleSubscribe}
              />
            </motion.div>
          </div>
        </section>

        {/* Pricing Transparency Section */}
        <section className="relative z-10 py-20">
          <div className="max-w-6xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  How Pricing Works
                </span>
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="relative group"
              >
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500" />
                <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 h-full">
                  <div className="text-5xl mb-4">💳</div>
                  <h3 className="text-xl font-bold text-white mb-3">1. Calculate</h3>
                  <p className="text-slate-300">
                    Use the calculator above to estimate your monthly credit needs based on agents, plugins, and execution frequency.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="relative group"
              >
                <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500" />
                <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 h-full">
                  <div className="text-5xl mb-4">⚡</div>
                  <h3 className="text-xl font-bold text-white mb-3">2. Subscribe</h3>
                  <p className="text-slate-300">
                    Your Pilot Credit subscription is set to the calculated amount. Update anytime as your needs change - it's completely flexible.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="relative group"
              >
                <div className="absolute -inset-0.5 bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500" />
                <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 h-full">
                  <div className="text-5xl mb-4">🚀</div>
                  <h3 className="text-xl font-bold text-white mb-3">3. Run & Rollover</h3>
                  <p className="text-slate-300">
                    Pilot Credits are consumed as agents run. Unused Pilot Credits roll over forever. Need more? Buy Boost Packs instantly.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="relative z-10 py-20">
          <div className="max-w-4xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Frequently Asked Questions
                </span>
              </h2>
            </motion.div>

            <div className="space-y-6">
              {faqs.map((faq, index) => (
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

        {/* CTA Section */}
        <section className="relative z-10 py-20">
          <div className="max-w-4xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative group"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
              <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 border border-white/20 text-center">
                <h3 className="text-3xl font-bold text-white mb-4">Ready to Automate?</h3>
                <p className="text-slate-300 mb-8 max-w-2xl mx-auto text-lg">
                  Start with 1,000 free trial credits. No credit card required.
                  Build your first agent in minutes.
                </p>
                <button
                  onClick={() => router.push('/signup')}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-10 py-4 rounded-xl font-bold text-lg transition-all duration-300 hover:scale-105 shadow-lg"
                >
                  Start Free Trial
                </button>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  )
}
