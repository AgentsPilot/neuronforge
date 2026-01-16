'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Brain,
  MessageSquare,
  CheckCircle,
  ArrowRight,
  Sparkles,
  Clock,
  FileText,
  AlertCircle,
  BarChart3,
  Users,
  Shield,
  Eye,
  StopCircle,
  TrendingUp,
  Zap,
  ChevronDown,
  Send,
  PlayCircle,
  Link2,
  Lock,
  Activity
} from 'lucide-react';
import PilotCreditCalculator from '@/components/billing/PilotCreditCalculator';
import DevelopmentVsAgentsPilotCalculator from '@/components/marketing/DevelopmentVsAgentsPilotCalculator';
import { useRouter } from 'next/navigation';

export default function MarketingPage() {
  const router = useRouter();
  const [expandedUseCase, setExpandedUseCase] = useState<number | null>(null);
  const [userInput, setUserInput] = useState('');

  const handleSubscribe = async (monthlyCredits: number, inputs: any) => {
    // Redirect to signup page with pricing info
    router.push(`/signup?credits=${monthlyCredits}&agents=${inputs.numAgents}&plugins=${inputs.avgPluginsPerAgent}`);
  };

  const useCases = [
    {
      title: "Monitor my inbox and draft replies I can approve",
      icon: Mail,
      color: "#3b82f6",
      details: {
        what: ["Reads incoming emails", "Identifies urgency", "Summarizes key points", "Drafts responses if needed"],
        see: ["A short summary", "A suggestion", "An alert if needed"],
        dont: ["No rules", "No conditions", "No setup"]
      }
    },
    {
      title: "Summarize weekly activity across my tools",
      icon: BarChart3,
      color: "#8b5cf6",
      details: {
        what: ["Connects to your tools", "Gathers activity data", "Identifies patterns", "Creates digestible summaries"],
        see: ["Weekly overview", "Key highlights", "Trends worth noting"],
        dont: ["No manual tracking", "No spreadsheets", "No data collection"]
      }
    },
    {
      title: "Alert me when something looks wrong",
      icon: AlertCircle,
      color: "#ef4444",
      details: {
        what: ["Monitors your systems", "Detects anomalies", "Assesses severity", "Notifies you immediately"],
        see: ["Clear alert", "Context provided", "Suggested actions"],
        dont: ["No manual checking", "No complex rules", "No false alarms"]
      }
    },
    {
      title: "Prepare reports before meetings",
      icon: FileText,
      color: "#10b981",
      details: {
        what: ["Reviews upcoming meetings", "Gathers relevant data", "Compiles insights", "Formats professionally"],
        see: ["Ready-to-use report", "Key talking points", "Supporting data"],
        dont: ["No manual prep", "No last-minute scrambling", "No data hunting"]
      }
    },
    {
      title: "Track important conversations and decisions",
      icon: MessageSquare,
      color: "#f59e0b",
      details: {
        what: ["Monitors communication channels", "Identifies key decisions", "Tracks action items", "Maintains context"],
        see: ["Decision log", "Action items", "Context history"],
        dont: ["No note-taking", "No searching", "No memory gaps"]
      }
    },
    {
      title: "Handle routine follow-ups so I don't have to",
      icon: Clock,
      color: "#06b6d4",
      details: {
        what: ["Tracks pending items", "Determines timing", "Drafts follow-ups", "Sends when appropriate"],
        see: ["Scheduled follow-ups", "Response tracking", "Completion status"],
        dont: ["No manual reminders", "No forgotten tasks", "No awkward delays"]
      }
    },
    {
      title: "Monitor project status and flag blockers",
      icon: TrendingUp,
      color: "#ec4899",
      details: {
        what: ["Tracks project milestones", "Identifies dependencies", "Spots bottlenecks", "Alerts stakeholders"],
        see: ["Status updates", "Risk warnings", "Progress reports"],
        dont: ["No manual status checks", "No missed deadlines", "No surprise delays"]
      }
    },
    {
      title: "Screen and qualify incoming leads",
      icon: Users,
      color: "#14b8a6",
      details: {
        what: ["Reviews lead information", "Checks fit criteria", "Scores priority", "Routes to right team"],
        see: ["Qualified leads", "Priority ranking", "Next best action"],
        dont: ["No manual screening", "No wasted calls", "No missed opportunities"]
      }
    },
    {
      title: "Organize and categorize incoming content",
      icon: Sparkles,
      color: "#a855f7",
      details: {
        what: ["Analyzes content type", "Tags and labels", "Files appropriately", "Highlights priorities"],
        see: ["Organized inbox", "Tagged items", "Priority queue"],
        dont: ["No manual sorting", "No lost files", "No cluttered folders"]
      }
    }
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* 1. HERO SECTION */}
      <section className="relative flex items-center justify-center overflow-hidden pt-12 md:pt-16 pb-8 md:pb-12 border-b border-zinc-800 bg-zinc-950">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20" />

        {/* Accent gradient - more subtle */}
        <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 via-transparent to-transparent" />

        <div className="relative max-w-7xl mx-auto px-4 lg:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 items-center">

            {/* Left: Plain Language */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              <div className="space-y-4">
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight">
                  Your Personal
                  <br />
                  <span className="text-orange-500">AI Workforce</span>
                </h1>

                <p className="text-xl md:text-2xl text-zinc-400 leading-relaxed font-light">
                  AI agents that understand your work, handle tasks for you, and get smarter over time. no technical setup required.
                </p>
              </div>

              {/* Primary CTA - Chat-style input */}
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Describe what you want done..."
                    className="w-full px-6 py-4 bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500 transition-colors font-mono text-sm"
                  />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-orange-500 hover:bg-orange-600 font-medium transition-colors flex items-center gap-2">
                    Create Agent
                    <Send className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => document.getElementById('use-cases')?.scrollIntoView({ behavior: 'smooth' })}
                  className="text-slate-400 hover:text-white transition-colors flex items-center gap-2"
                >
                  See real examples
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </motion.div>

            {/* Right: Simple Clean Visualization */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="relative hidden lg:block"
            >
              <div className="bg-zinc-900 border border-zinc-800 p-8">
                <div className="space-y-4">
                  {[
                    { icon: Mail, label: 'Monitor inbox', sublabel: 'Draft replies', iconColor: '#3b82f6', borderColor: '#3b82f6', delay: 0.5 },
                    { icon: FileText, label: 'Review documents', sublabel: 'Extract key info', iconColor: '#8b5cf6', borderColor: '#8b5cf6', delay: 0.7 },
                    { icon: BarChart3, label: 'Track metrics', sublabel: 'Spot trends', iconColor: '#10b981', borderColor: '#10b981', delay: 0.9 },
                    { icon: MessageSquare, label: 'Follow up', sublabel: 'Never miss a beat', iconColor: '#f59e0b', borderColor: '#f59e0b', delay: 1.1 }
                  ].map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: item.delay, ease: [0.16, 1, 0.3, 1] }}
                        whileHover={{ x: 8, scale: 1.02, transition: { duration: 0.2 } }}
                        className="flex items-start gap-4 p-4 bg-zinc-800/50 border-l-2 cursor-pointer group"
                        style={{ borderColor: item.borderColor }}
                      >
                        <div className="flex-shrink-0 mt-1">
                          <motion.div
                            animate={{ rotate: [0, 5, 0, -5, 0] }}
                            transition={{ duration: 2, repeat: Infinity, delay: idx * 0.3 }}
                          >
                            <Icon className="w-6 h-6" style={{ color: item.iconColor }} />
                          </motion.div>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-white mb-1 transition-colors group-hover:opacity-80">
                            {item.label}
                          </div>
                          <div className="text-sm text-zinc-400 font-mono">
                            {item.sublabel}
                          </div>
                        </div>
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 2, repeat: Infinity, delay: idx * 0.5 }}
                          className="w-2 h-2 rounded-full bg-green-500 mt-2"
                        />
                      </motion.div>
                    );
                  })}
                </div>

                {/* Status bar */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 1.3 }}
                  className="mt-6 pt-6 border-t border-zinc-800 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-green-500"
                    />
                    <span className="text-xs font-mono text-zinc-500">All systems active</span>
                  </div>
                  <div className="text-xs font-mono text-zinc-600">24/7 monitoring</div>
                </motion.div>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* 2. WHAT IT FEELS LIKE */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-8 md:mb-12 tracking-tight"
          >
            What using AgentsPilot <span className="text-orange-500">feels like</span>
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                title: "You explain",
                description: '"Every morning, review new emails from clients and alert me if anything urgent comes in."',
                icon: MessageSquare,
                delay: 0
              },
              {
                title: "AgentsPilot builds",
                description: "AgentsPilot understands your intent, asks what's missing, and sets up the agent for you.",
                icon: Brain,
                delay: 0.2
              },
              {
                title: "Work gets done",
                description: "The agent runs on its own now, later, or continuously.",
                icon: CheckCircle,
                delay: 0.4
              }
            ].map((card, idx) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 50, scale: 0.95 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: card.delay, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -8, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
                  className="bg-zinc-900 border border-zinc-800 p-8 hover:border-zinc-700 transition-colors"
                >
                  <Icon className="w-10 h-10 text-orange-500 mb-6" />
                  <h3 className="text-xl font-semibold mb-4 tracking-tight">{card.title}</h3>
                  <p className="text-zinc-400 leading-relaxed">{card.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. REAL LIFE USE CASES */}
      <section id="use-cases" className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-6 md:mb-8"
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-3 tracking-tight">
              Built for <span className="text-orange-500">real people</span> doing real work
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {useCases.map((useCase, idx) => {
              const Icon = useCase.icon;
              const isExpanded = expandedUseCase === idx;

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
                  className={`cursor-pointer transition-all ${isExpanded ? 'md:col-span-2 lg:col-span-3' : ''}`}
                  onClick={() => setExpandedUseCase(isExpanded ? null : idx)}
                >
                  <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 p-6 transition-colors h-full">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${useCase.color}20` }}>
                        <Icon className="w-5 h-5" style={{ color: useCase.color }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-medium leading-relaxed">{useCase.title}</p>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-6 space-y-6"
                            >
                              <div>
                                <h4 className="text-sm font-semibold text-orange-400 mb-3">What the agent does</h4>
                                <ul className="space-y-2">
                                  {useCase.details.what.map((item, i) => (
                                    <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                                      <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-orange-400 mb-3">What you see</h4>
                                <ul className="space-y-2">
                                  {useCase.details.see.map((item, i) => (
                                    <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                                      <Eye className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-orange-400 mb-3">What you don't do</h4>
                                <ul className="space-y-2">
                                  {useCase.details.dont.map((item, i) => (
                                    <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                                      <StopCircle className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <button className="mt-4 px-6 py-3 bg-orange-500 hover:bg-orange-600 rounded-xl font-semibold transition-colors flex items-center gap-2">
                                Create this agent
                                <ArrowRight className="w-4 h-4" />
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. WHY THIS IS DIFFERENT */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-12 md:mb-16 tracking-tight"
          >
            This isn't automation. <span className="text-orange-500">It's delegation.</span>
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            {/* Traditional Tools */}
            <motion.div
              initial={{ opacity: 0, x: -50, scale: 0.95 }}
              whileInView={{ opacity: 1, x: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="bg-zinc-900/50 border border-zinc-800 p-8"
            >
              <h3 className="text-lg font-medium text-zinc-500 uppercase tracking-wide mb-6">Traditional Tools</h3>
              <ul className="space-y-5">
                {[
                  "You define every rule",
                  "You maintain logic",
                  "You fix failures",
                  "You manage complexity"
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-zinc-400 text-base">
                    <div className="w-5 h-5 border border-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <div className="w-1.5 h-1.5 bg-zinc-600" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* AgentPilot */}
            <motion.div
              initial={{ opacity: 0, x: 50, scale: 0.95 }}
              whileInView={{ opacity: 1, x: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              className="bg-zinc-900/50 border border-orange-500/30 p-8"
            >
              <h3 className="text-lg font-medium text-orange-500 uppercase tracking-wide mb-6">AgentsPilot</h3>
              <ul className="space-y-5">
                {[
                  "You describe intent",
                  "Agents reason and adapt",
                  "System governs reliability",
                  "You stay in control"
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-white text-base">
                    <CheckCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 5. HOW AGENTS WORK */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-3 tracking-tight"
          >
            How agents <span className="text-orange-500">actually work</span>
          </motion.h2>
          <p className="text-center text-zinc-500 mb-16 md:mb-20 font-mono text-sm uppercase tracking-wider"></p>

          <div className="relative max-w-3xl mx-auto">
            {/* Vertical Timeline Line - More Prominent */}
            <div className="absolute left-6 md:left-12 top-0 bottom-0 w-0.5 bg-zinc-800 hidden md:block">
              <motion.div
                initial={{ height: 0 }}
                whileInView={{ height: "100%" }}
                viewport={{ once: true }}
                transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-full bg-gradient-to-b from-orange-500 via-orange-500/50 to-orange-500"
              />
            </div>

            <div className="space-y-12 md:space-y-16">
              {[
                {
                  title: "Understand",
                  description: "The agent parses your intent and identifies the goal. No rigid rules—just natural understanding.",
                  icon: Brain,
                  delay: 0,
                  color: "#f97316"
                },
                {
                  title: "Connect",
                  description: "It safely connects to the tools you already use. Secure, permission-based access only.",
                  icon: Link2,
                  delay: 0.2,
                  color: "#3b82f6"
                },
                {
                  title: "Act",
                  description: "It performs actions or watches for changes. You approve what matters.",
                  icon: Activity,
                  delay: 0.4,
                  color: "#10b981"
                },
                {
                  title: "Improve",
                  description: "Each run produces insights and improvements. Your agent learns what works.",
                  icon: TrendingUp,
                  delay: 0.6,
                  color: "#8b5cf6"
                }
              ].map((step, idx) => {
                const Icon = step.icon;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -30 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: step.delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    className="relative flex items-start gap-6 md:gap-8"
                  >
                    {/* Timeline Icon */}
                    <div className="relative flex-shrink-0 z-10">
                      {/* Icon container */}
                      <motion.div
                        initial={{ scale: 0 }}
                        whileInView={{ scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: step.delay + 0.1, duration: 0.5, type: "spring" }}
                        className="relative w-12 h-12 md:w-16 md:h-16 bg-black border-4 flex items-center justify-center"
                        style={{ borderColor: step.color }}
                      >
                        <Icon className="w-6 h-6 md:w-8 md:h-8" style={{ color: step.color }} />
                      </motion.div>

                      {/* Step number badge */}
                      <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-zinc-900 border-2 flex items-center justify-center" style={{ borderColor: step.color }}>
                        <span className="text-xs font-bold font-mono" style={{ color: step.color }}>
                          {idx + 1}
                        </span>
                      </div>
                    </div>

                    {/* Content Card */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: step.delay + 0.3, duration: 0.6 }}
                      whileHover={{ x: 8, transition: { duration: 0.3 } }}
                      className="flex-1 bg-zinc-900/50 border border-zinc-800 p-6 md:p-8 group hover:bg-zinc-900 hover:border-zinc-700 transition-all duration-300"
                    >
                      <h3 className="text-2xl md:text-3xl font-bold mb-3 tracking-tight transition-colors duration-300" style={{ color: step.color }}>
                        {step.title}
                      </h3>
                      <p className="text-zinc-400 text-base md:text-lg leading-relaxed group-hover:text-zinc-300 transition-colors duration-300">
                        {step.description}
                      </p>

                      {/* Progress indicator */}
                      <motion.div
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: step.delay + 0.5, duration: 0.8 }}
                        className="h-1 mt-6 origin-left"
                        style={{ backgroundColor: step.color, opacity: 0.3 }}
                      />
                    </motion.div>
                  </motion.div>
                );
              })}
            </div>

            {/* Bottom flow indicator */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.8, duration: 0.7 }}
              className="mt-12 flex items-center justify-center gap-3"
            >
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 1 + (i * 0.1), duration: 0.4 }}
                    className="w-2 h-2 bg-orange-500/50"
                  />
                ))}
              </div>
              <ArrowRight className="w-4 h-4 text-orange-500/50" />
              <span className="text-xs font-mono text-zinc-600 uppercase tracking-wider">Continuous improvement</span>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 6. COST COMPARISON: DEVELOPMENT VS AGENTSPILOT */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-4 tracking-tight"
          >
            Building vs <span className="text-orange-500">Buying</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="text-center text-zinc-400 mb-12 md:mb-16 max-w-3xl mx-auto text-lg"
          >
            See how much you save by using AgentsPilot instead of building custom automation from scratch.
          </motion.p>

          <DevelopmentVsAgentsPilotCalculator />
        </div>
      </section>

      {/* 7. TRUST & SAFETY */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-8 md:mb-12 tracking-tight"
          >
            You're always <span className="text-orange-500">in control</span>
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {[
              { icon: Eye, text: "You approve actions" },
              { icon: Activity, text: "You see every result" },
              { icon: StopCircle, text: "You can stop any agent" },
              { icon: Lock, text: "Nothing runs without your permission" }
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 30, scale: 0.9 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -8, scale: 1.05, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
                  className="bg-zinc-900 border border-zinc-800 p-6 text-center"
                >
                  <Icon className="w-8 h-8 text-orange-500 mx-auto mb-4" />
                  <p className="text-white font-medium text-sm">{item.text}</p>
                </motion.div>
              );
            })}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6 }}
            className="text-center text-zinc-500 mt-6 md:mt-8 text-sm"
          >
            Built with enterprise grade security without enterprise complexity.
          </motion.p>
        </div>
      </section>

      {/* 8. SMART INSIGHTS */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-6 md:mb-8"
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-3 md:mb-4 tracking-tight">
              Agents don't just act <span className="text-orange-500">they think</span>
            </h2>
            <p className="text-lg md:text-xl text-zinc-400 max-w-3xl mx-auto font-light">
              After each run, your agent provides insights: what changed, what matters, what you should consider next.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {[
              { text: "Response times are slowing", color: "#f59e0b" },
              { text: "This client's tone shifted", color: "#8b5cf6" },
              { text: "This task could be automated further", color: "#3b82f6" }
            ].map((insight, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                whileInView={{ opacity: 1, scale: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ scale: 1.05, x: 8, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
                className="bg-zinc-900 border-l-2 p-6" style={{ borderColor: insight.color }}
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: insight.color }} />
                  <p className="text-zinc-300 font-mono text-sm">"{insight.text}"</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. WHO IT'S FOR */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-8 md:mb-12 tracking-tight"
          >
            Built for people who <span className="text-orange-500">run things</span>
          </motion.h2>

          <div className="flex flex-wrap justify-center gap-3 md:gap-5">
            {[
              { icon: Users, label: "Business owners" },
              { icon: Sparkles, label: "Consultants" },
              { icon: Activity, label: "Operators" },
              { icon: Users, label: "Teams" },
              { icon: Brain, label: "Professionals" }
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.8, y: 20 }}
                  whileInView={{ opacity: 1, scale: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ scale: 1.1, y: -8, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
                  className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-8 py-6 transition-colors"
                >
                  <Icon className="w-7 h-7 text-orange-500 mx-auto mb-3" />
                  <p className="text-white font-medium text-center text-sm">{item.label}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 10. PRICING */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-3 tracking-tight"
          >
            Simple <span className="text-orange-500">transparent</span> pricing
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="text-center text-zinc-400 mb-12 md:mb-16 max-w-2xl mx-auto"
          >
            Pay only for what you use. No fixed tiers. Calculate your exact needs with our Smart Fuel Auto-Plan.
          </motion.p>

          <div className="max-w-4xl mx-auto">
            <PilotCreditCalculator
              showSubscribeButton={true}
              onSubscribe={handleSubscribe}
            />
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="text-center text-zinc-500 mt-8 text-sm"
          >
            Start with 10,417 free Pilot Credits. No credit card required.
          </motion.p>
        </div>
      </section>

      {/* 11. FINAL CTA */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6 md:space-y-8"
          >
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
              Stop managing work.
              <br />
              <span className="text-orange-500">Start delegating it.</span>
            </h2>

            <div className="max-w-2xl mx-auto">
              <div className="flex flex-col md:flex-row gap-4">
                <input
                  type="text"
                  placeholder="What do you want an agent to handle for you?"
                  className="flex-1 px-6 py-4 bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-500 text-base focus:outline-none focus:border-orange-500 transition-colors"
                />
                <button className="px-8 py-4 bg-orange-500 hover:bg-orange-600 font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap">
                  Create my first agent
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
