'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import PilotCreditCalculator from '@/components/billing/PilotCreditCalculator'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Calculator, Zap, Repeat, CheckCircle } from 'lucide-react'

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
      question: "How are Pilot Credits managed?",
      answer: "Pilot Credits are allocated monthly based on your subscription. You can purchase additional Boost Packs anytime for extra capacity. Adjust your subscription up or down as your needs change."
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
      answer: "Yes! Every new user gets 10,417 free Pilot Credits, 100MB of storage space, and up to 50 total executions (whichever limit is reached first). No credit card required to start building."
    }
  ]

  return (
    <div className="min-h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <motion.div
          animate={{
            backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-orange-900/20 via-zinc-900/30 to-transparent bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            backgroundPosition: ['100% 100%', '0% 0%', '100% 100%'],
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-orange-900/15 via-transparent to-transparent bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            x: [0, 150, 0],
            y: [0, -150, 0],
            scale: [1, 1.3, 1],
            opacity: [0.15, 0.3, 0.15]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-20 left-20 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -150, 0],
            y: [0, 150, 0],
            scale: [1, 1.4, 1],
            opacity: [0.15, 0.3, 0.15]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, 100, -100, 0],
            y: [0, -100, 100, 0],
            scale: [1, 1.2, 1.3, 1],
            opacity: [0.1, 0.2, 0.15, 0.1]
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/8 rounded-full blur-3xl"
        />
      </div>

      <div className="relative z-10">
        {/* Header Section */}
        <section className="relative z-10 pt-20 pb-16">
          <div className="max-w-7xl mx-auto px-4 lg:px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center space-y-8"
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="space-y-2"
              >
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-black leading-tight">
                  <span className="text-orange-400 block">
                    Pay Only for
                  </span>
                  <span className="text-white block">
                    What You Use
                  </span>
                </h1>
              </motion.div>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-base md:text-lg text-slate-300 max-w-4xl mx-auto leading-relaxed"
              >
                Smart Fuel Auto-Plan: Calculate your exact needs. No fixed tiers.
                <br />
                Pay only for what you use.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex flex-wrap items-center justify-center gap-4 pt-4 border-t border-white/10 text-sm text-slate-400"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Flexible pricing</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Cancel anytime</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>1,000 free trial credits</span>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Calculator Section */}
        <section className="relative z-10 py-16">
          <div className="max-w-4xl mx-auto px-4 lg:px-6">
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
          <div className="max-w-6xl mx-auto px-4 lg:px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-black">
                <span className="text-orange-400">
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
              >
                <div className="bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-orange-400/30 transition-all duration-300 h-full">
                  <div className="mb-4"><Calculator className="w-12 h-12 text-orange-400" /></div>
                  <h3 className="text-xl font-bold mb-3">1. Calculate</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Use the calculator above to estimate your monthly credit needs based on agents, plugins, and execution frequency.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div className="bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-orange-400/30 transition-all duration-300 h-full">
                  <div className="mb-4"><Zap className="w-12 h-12 text-amber-400" /></div>
                  <h3 className="text-xl font-bold mb-3">2. Subscribe</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Your Pilot Credit subscription is set to the calculated amount. Update anytime as your needs change - it's completely flexible.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <div className="bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-orange-400/30 transition-all duration-300 h-full">
                  <div className="mb-4"><Zap className="w-12 h-12 text-orange-400" /></div>
                  <h3 className="text-xl font-bold mb-3">3. Run & Scale</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Pilot Credits are consumed as agents run. Need more? Buy Boost Packs instantly or adjust your subscription anytime.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="relative z-10 py-20">
          <div className="max-w-4xl mx-auto px-4 lg:px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-16 space-y-2"
            >
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-black">
                <span className="text-orange-400">
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
                  className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-xl rounded-2xl p-6 md:p-8 border border-white/10 hover:border-white/20 transition"
                >
                  <h3 className="text-lg md:text-xl font-bold mb-3 text-white">{faq.question}</h3>
                  <p className="text-sm md:text-base text-slate-400 leading-relaxed">{faq.answer}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative z-10 py-20">
          <div className="max-w-4xl mx-auto px-4 lg:px-6">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-2xl rounded-3xl p-8 md:p-12 border border-white/20 text-center space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl md:text-3xl font-bold text-white">Ready to Automate?</h3>
                  <p className="text-sm md:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
                    Start with 10,417 free Pilot Credits. No credit card required.
                    Build your first agent in minutes.
                  </p>
                </div>
                <button
                  onClick={() => router.push('/signup')}
                  className="group relative px-6 py-2.5 bg-orange-500 rounded-lg font-bold text-sm text-white hover:shadow-xl hover:shadow-orange-500/50 hover:bg-orange-600 transition-all duration-300 hover:scale-105 overflow-hidden"
                >
                  <span className="relative flex items-center justify-center gap-2">
                    Start Free Trial
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  )
}
