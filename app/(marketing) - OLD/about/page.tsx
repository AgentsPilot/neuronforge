'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Brain,
  Lightbulb,
  Heart,
  Rocket,
  ArrowRight,
  CheckCircle,
  Bot,
  Link2,
  Music,
  AlertCircle,
  Sparkles
} from 'lucide-react';

const AboutPage = () => {
  const [hoveredSection, setHoveredSection] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* Hero Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <motion.h1
              className="text-3xl md:text-4xl lg:text-5xl font-black mb-6 leading-tight"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <span className="text-orange-400">
                The Future of Work
              </span>
              <br />
              <span className="text-white">Is Personal AI</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-base md:text-lg text-slate-300 max-w-4xl mx-auto mb-8 leading-relaxed"
            >
              We're building the world's first AI Workforce for everyone intelligent agents that understand your intentand execute your vision across all your tools, without a single line of code.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                href="/signup"
                className="group px-8 py-4 bg-orange-500 hover:bg-orange-600 font-bold text-lg hover:shadow-2xl hover:shadow-orange-500/50 transition flex items-center gap-2"
              >
                See It In Action
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* The Vision Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-4">
              <span className="text-orange-400">
                Reimagining Automation
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-3xl mx-auto">
              Today's automation tools are complex, technical, and built for engineers. We believe everyone deserves intelligent automation.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 md:gap-12">
            {/* The Problem Card */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-zinc-900/90 backdrop-blur-xl p-8 md:p-10 border border-zinc-800 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-red-500/10">
                    <AlertCircle className="w-7 h-7 text-red-400" />
                  </div>
                  <h3 className="text-2xl md:text-3xl font-black text-white">
                    The Problem
                  </h3>
                </div>

                <div className="space-y-6 flex-1">
                  <div className="flex gap-3">
                    <div className="w-1.5 bg-red-400/30 flex-shrink-0"></div>
                    <p className="text-base md:text-lg text-slate-300 leading-relaxed">
                      Professionals spend <span className="text-white font-semibold">hours on repetitive digital tasks</span> copying data between tools, sending routine emails, organizing files, tracking deadlines.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-1.5 bg-red-400/30 flex-shrink-0"></div>
                    <p className="text-base md:text-lg text-slate-300 leading-relaxed">
                      Existing automation requires <span className="text-white font-semibold">technical setup, complex workflows, and constant maintenance</span>. Most people want outcomes, not setup screens.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-1.5 bg-red-400/30 flex-shrink-0"></div>
                    <p className="text-base md:text-lg text-slate-300 leading-relaxed">
                      They want to <span className="text-white font-semibold">describe what they need and see it work</span> instantly.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Our Solution Card */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <div className="bg-zinc-900/90 backdrop-blur-xl p-8 md:p-10 border border-orange-400/30 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-orange-500/20">
                    <Sparkles className="w-7 h-7 text-orange-400" />
                  </div>
                  <h3 className="text-2xl md:text-3xl font-black text-white">
                    Our Solution
                  </h3>
                </div>

                <div className="space-y-6 flex-1">
                  <div className="flex gap-3">
                    <div className="w-1.5 bg-orange-400/50 flex-shrink-0"></div>
                    <p className="text-base md:text-lg text-slate-200 leading-relaxed">
                      AgentsPilot <span className="text-orange-400 font-semibold">transforms natural language into intelligent agents</span>. Simply describe your goal, and our AI understands your intent, designs the workflow, and executes it seamlessly.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-1.5 bg-orange-400/50 flex-shrink-0"></div>
                    <p className="text-base md:text-lg text-slate-200 leading-relaxed">
                      <span className="text-white font-semibold">No scripts. No complex integrations. No technical knowledge required.</span>
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-1.5 bg-orange-400/50 flex-shrink-0"></div>
                    <p className="text-base md:text-lg text-slate-200 leading-relaxed">
                      Just <span className="text-orange-400 font-semibold">human ideas becoming automated reality</span> in seconds.
                    </p>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-orange-400/20">
                  <Link
                    href="/signup"
                    className="group px-6 py-3.5 bg-orange-500 hover:bg-orange-600 font-bold text-white transition-all duration-300 hover:shadow-2xl hover:shadow-orange-500/50 flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    Start Building Free
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-4">
              <span className="text-orange-400">
                Four Simple Steps
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              From idea to automation in under two minutes
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                step: "01",
                title: "Type Your Goal",
                description: "Describe what you want in plain English. No technical knowledge needed.",
                icon: <Lightbulb className="w-8 h-8 text-orange-400" />,
                color: "blue"
              },
              {
                step: "02",
                title: "AI Clarifies Intent",
                description: "Our intelligent system asks clarifying questions to understand exactly what you need.",
                icon: <Brain className="w-8 h-8 text-orange-400" />,
                color: "purple"
              },
              {
                step: "03",
                title: "Instant Build",
                description: "AgentsPilot designs the workflow, connects tools, and configures everything automatically.",
                icon: <Rocket className="w-8 h-8 text-orange-400" />,
                color: "pink"
              },
              {
                step: "04",
                title: "Your AI Pilot Runs It",
                description: "Your personal agent executes tasks on demand, on schedule, or triggered by events.",
                icon: <Heart className="w-8 h-8 text-orange-400" />,
                color: "green"
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="relative group"
                onHoverStart={() => setHoveredSection(index)}
                onHoverEnd={() => setHoveredSection(null)}
              >
                <div className="bg-zinc-900/90 backdrop-blur-xl p-8 border border-zinc-800 hover:border-orange-400/30 transition-all duration-300 h-full text-center">
                  <div className="text-sm font-bold text-slate-500 mb-2">STEP {item.step}</div>
                  <div className="mb-6 flex justify-center">
                    <motion.div
                      animate={hoveredSection === index ? { scale: 1.1, rotate: 360 } : { scale: 1, rotate: 0 }}
                      transition={{ duration: 0.5 }}
                    >
                      {item.icon}
                    </motion.div>
                  </div>
                  <h3 className="text-xl font-bold mb-4 text-white">{item.title}</h3>
                  <p className="text-slate-400 leading-relaxed text-sm">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-12">
              <span className="text-orange-400">
                Our Philosophy
              </span>
            </h2>

            <div className="grid md:grid-cols-2 gap-8 text-left max-w-4xl mx-auto">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">AI Should Work for You</h3>
                  <p className="text-slate-300">Not overwhelm you with complexity. Intelligence should amplify human capability, not replace human judgment.</p>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Human Ideas First</h3>
                  <p className="text-slate-300">The best automations start with human creativity and intent, not technical specifications.</p>
                </div>
              </div>
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Everyone Deserves AI Power</h3>
                  <p className="text-slate-300">Intelligent automation shouldn't require engineering expertise. It should be as natural as conversation.</p>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">Trust Through Transparency</h3>
                  <p className="text-slate-300">You should always understand what your agents do, how they work, and maintain full control.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Behind AgentsPilot Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-zinc-900/95 backdrop-blur-2xl p-12 md:p-16 border border-zinc-800">
              <h2 className="text-3xl md:text-4xl font-black mb-8 text-center">
                <span className="text-orange-400">
                  Behind AgentsPilot
                </span>
              </h2>

              <div className="space-y-6 text-slate-300 max-w-4xl mx-auto text-center">
                <p className="text-xl leading-relaxed">
                  AgentsPilot was born from a simple frustration: watching brilliant professionals
                  waste hours on repetitive digital tasks that should be automated.
                </p>
                <p className="text-xl leading-relaxed">
                  We experienced firsthand how existing automation tools failed
                  non-technical users. AgentsPilot represents a fundamental shift in how we think about AI and work.
                </p>
                <p className="text-xl leading-relaxed">
                  We believe the future isn't about replacing humans with AI, it's about giving 
                  every professional their own intelligent pilot to handle the mundane, 
                  so they can focus on what truly matters.
                </p>
                <p className="text-xl leading-relaxed">
                  Every design decision prioritizes simplicity, trust, and human empowerment. 
                  Because AI should make work more human, not less.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Future of Work Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-4">
              <span className="text-orange-400">
                The Future We're Building
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-3xl mx-auto">
              A world where every professional has a personal AI workforce
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Personal AI Workforce",
                description: "Every professional will have intelligent agents handling routine tasks, freeing humans for creative and strategic work.",
                icon: <Bot className="w-12 h-12 text-orange-400" />
              },
              {
                title: "Cross-Tool Collaboration",
                description: "Agents will seamlessly coordinate across all your tools Gmail, Slack, Notion, CRM creating unified workflows.",
                icon: <Link2 className="w-12 h-12 text-orange-400" />
              },
              {
                title: "Human + AI Orchestration",
                description: "The best outcomes come from humans setting the vision and AI handling execution, creating perfect collaboration.",
                icon: <Music className="w-12 h-12 text-orange-400" />
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className="bg-zinc-900/90 backdrop-blur-xl p-8 border border-zinc-800 hover:border-orange-400/30 transition-all duration-300 text-center"
              >
                <div className="flex justify-center mb-6">{item.icon}</div>
                <h3 className="text-xl font-bold mb-4 text-white">{item.title}</h3>
                <p className="text-slate-400 leading-relaxed">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission Statement */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 lg:px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-zinc-900/95 backdrop-blur-2xl p-12 md:p-16 border border-zinc-800">
              <h2 className="text-2xl md:text-3xl font-black mb-6">
                <span className="text-orange-400">
                  Our Mission
                </span>
              </h2>
              <p className="text-xl md:text-2xl text-white font-light leading-relaxed">
                To make intelligent automation accessible to everyone one natural-language agent at a time.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900">
        <div className="max-w-4xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-zinc-900/95 backdrop-blur-2xl p-12 md:p-16 border border-zinc-800 text-center">
              <h2 className="text-3xl md:text-4xl font-black mb-6">
                Ready to Meet
                <br />
                <span className="text-orange-400">
                  Your AI Pilot?
                </span>
              </h2>
              <p className="text-base md:text-lg text-slate-300 mb-8 max-w-2xl mx-auto">
                Join thousands of professionals who've discovered the power of natural-language automation.
                Build your first agent in under 2 minutes.
              </p>
              
              <Link
                href="/signup"
                className="px-8 py-4 bg-orange-500 hover:bg-orange-600 font-bold text-lg hover:shadow-2xl hover:shadow-orange-500/50 transition flex items-center gap-2 mx-auto"
              >
                Create Your First Agent
                <ArrowRight className="w-5 h-5" />
              </Link>

              <div className="flex items-center justify-center gap-6 mt-8 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Free to start</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>No technical skills required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Ready in minutes</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;