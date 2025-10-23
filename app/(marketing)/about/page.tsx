'use client';

import React, { useState } from 'react';
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

      {/* Hero Section */}
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
                The Future of Work
              </span>
              <br />
              <span className="text-white">Is Personal AI</span>
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-xl md:text-2xl text-slate-300 max-w-4xl mx-auto mb-8 leading-relaxed"
            >
              We're building the world's first AI Workforce for everyone — intelligent agents that understand your intent
              <br />
              and execute your vision across all your tools, without a single line of code.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <button className="group px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-bold text-lg hover:shadow-2xl hover:shadow-purple-500/50 transition flex items-center gap-2">
                See It In Action
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* The Vision Section */}
      <section className="relative z-10 py-16">
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
                Reimagining Automation
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-3xl mx-auto">
              Today's automation tools are complex, technical, and built for engineers. We believe everyone deserves intelligent automation.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-16 items-stretch">
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="flex flex-col"
            >
              <h3 className="text-3xl font-bold mb-6 text-white flex items-center gap-3">
                <AlertCircle className="w-8 h-8 text-red-400" />
                The Problem
              </h3>
              <div className="space-y-4 text-slate-300">
                <p>
                  Professionals spend hours on repetitive digital tasks — copying data between tools,
                  sending routine emails, organizing files, tracking deadlines.
                </p>
                <p>
                  Existing automation requires technical setup, complex workflows, and constant maintenance.
                  Most people want outcomes, not setup screens.
                </p>
                <p>
                  They want to describe what they need and see it work — instantly.
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex flex-col"
            >
              <h3 className="text-3xl font-bold mb-6 text-white flex items-center gap-3">
                <Sparkles className="w-8 h-8 text-purple-400" />
                Our Solution
              </h3>
              <div className="space-y-4 text-slate-300">
                <p>
                  AgentPilot transforms natural language into intelligent agents. Simply describe your goal,
                  and our AI understands your intent, designs the workflow, and executes it seamlessly.
                </p>
                <p>
                  No scripts. No complex integrations. No technical knowledge required.
                </p>
                <p>
                  Just human ideas becoming automated reality in seconds.
                </p>
              </div>
              <a href="/signup" className="mt-6 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:shadow-lg hover:shadow-purple-500/50 rounded-lg font-semibold text-white transition flex items-center gap-2 w-fit">
                <Sparkles className="w-5 h-5" />
                Sign Up Free
                <ArrowRight className="w-4 h-4" />
              </a>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="relative z-10 py-32 bg-gradient-to-b from-transparent via-slate-900/20 to-transparent">
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
                Four Simple Steps
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              From idea to automation in under two minutes
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                step: "01",
                title: "Type Your Goal",
                description: "Describe what you want in plain English. No technical knowledge needed.",
                icon: <Lightbulb className="w-8 h-8 text-blue-400" />,
                color: "blue"
              },
              {
                step: "02",
                title: "AI Clarifies Intent",
                description: "Our intelligent system asks clarifying questions to understand exactly what you need.",
                icon: <Brain className="w-8 h-8 text-purple-400" />,
                color: "purple"
              },
              {
                step: "03",
                title: "Instant Build",
                description: "AgentPilot designs the workflow, connects tools, and configures everything automatically.",
                icon: <Rocket className="w-8 h-8 text-green-400" />,
                color: "pink"
              },
              {
                step: "04",
                title: "Your AI Pilot Runs It",
                description: "Your personal agent executes tasks on demand, on schedule, or triggered by events.",
                icon: <Heart className="w-8 h-8 text-pink-400" />,
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
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-0 group-hover:opacity-75 blur-lg transition duration-500" />
                <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 h-full text-center">
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
      <section className="relative z-10 py-32">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
            <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 md:p-16 border border-white/20 text-center">
              <h2 className="text-4xl md:text-5xl font-black mb-8">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
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
            </div>
          </motion.div>
        </div>
      </section>

      {/* Behind AgentPilot Section */}
      <section className="relative z-10 py-32">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
            <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 md:p-16 border border-white/20">
              <h2 className="text-4xl md:text-5xl font-black mb-8 text-center">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Behind AgentPilot
                </span>
              </h2>
              
              <div className="space-y-6 text-slate-300 max-w-4xl mx-auto text-center">
                <p className="text-xl leading-relaxed">
                  AgentPilot was born from a simple frustration: watching brilliant professionals 
                  waste hours on repetitive digital tasks that should be automated.
                </p>
                <p className="text-xl leading-relaxed">
                  We experienced firsthand how existing automation tools failed 
                  non-technical users. AgentPilot represents a fundamental shift in how we think about AI and work.
                </p>
                <p className="text-xl leading-relaxed">
                  We believe the future isn't about replacing humans with AI — it's about giving 
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
      <section className="relative z-10 py-32 bg-gradient-to-b from-transparent via-slate-900/20 to-transparent">
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
                The Future We're Building
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-3xl mx-auto">
              A world where every professional has a personal AI workforce
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Personal AI Workforce",
                description: "Every professional will have intelligent agents handling routine tasks, freeing humans for creative and strategic work.",
                icon: <Bot className="w-12 h-12 text-blue-400" />
              },
              {
                title: "Cross-Tool Collaboration",
                description: "Agents will seamlessly coordinate across all your tools — Gmail, Slack, Notion, CRM — creating unified workflows.",
                icon: <Link2 className="w-12 h-12 text-purple-400" />
              },
              {
                title: "Human + AI Orchestration",
                description: "The best outcomes come from humans setting the vision and AI handling execution, creating perfect collaboration.",
                icon: <Music className="w-12 h-12 text-pink-400" />
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-xl rounded-2xl p-8 border border-white/10 hover:border-white/20 transition text-center"
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
      <section className="relative z-10 py-32">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
            <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 md:p-16 border border-white/20">
              <h2 className="text-3xl md:text-4xl font-black mb-6">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Our Mission
                </span>
              </h2>
              <p className="text-2xl md:text-3xl text-white font-light leading-relaxed">
                To make intelligent automation accessible to everyone — 
                one natural-language agent at a time.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-32">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-75 blur-2xl group-hover:opacity-100 transition duration-1000" />
            <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 md:p-16 border border-white/20 text-center">
              <h2 className="text-4xl md:text-5xl font-black mb-6">
                Ready to Meet
                <br />
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Your AI Pilot?
                </span>
              </h2>
              <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                Join thousands of professionals who've discovered the power of natural-language automation.
                Build your first agent in under 2 minutes.
              </p>
              
              <button className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-bold text-lg hover:shadow-2xl hover:shadow-purple-500/50 transition flex items-center gap-2 mx-auto">
                Create Your First Agent
                <ArrowRight className="w-5 h-5" />
              </button>

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