'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Mail,
  TrendingUp,
  FileText,
  Calendar,
  Brain,
  Heart,
  Users,
  DollarSign,
  ArrowRight,
  CheckCircle
} from 'lucide-react';

const UseCasesPage = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const useCaseSections = [
    {
      title: "Marketing & Social Media",
      category: "Marketing",
      cases: [
        {
          name: "Social Media Scheduler",
          description: "Automatically posts your content across platforms and tracks engagement.",
          prompt: "Post my blog articles to LinkedIn and Twitter, then send me weekly engagement reports.",
          timeToCreate: "2 min",
          icon: <TrendingUp className="w-6 h-6 text-orange-400" />
        },
        {
          name: "Campaign Performance Tracker",
          description: "Monitors ad spend and performance, sending alerts when targets are hit.",
          prompt: "Track my Google Ads spend daily and alert me if any campaign exceeds $500.",
          timeToCreate: "1.5 min",
          icon: <TrendingUp className="w-6 h-6 text-orange-400" />
        }
      ]
    },
    {
      title: "Sales & CRM",
      category: "Sales",
      cases: [
        {
          name: "Client Follow-Up Assistant",
          description: "Sends weekly summaries of unread client emails and drafts personalized follow-ups.",
          prompt: "Summarize my unread client emails and draft polite follow-up replies.",
          timeToCreate: "1.7 min",
          icon: <Mail className="w-6 h-6 text-orange-400" />
        },
        {
          name: "Lead Qualification Bot",
          description: "Automatically scores new leads and adds qualified prospects to your CRM.",
          prompt: "When new leads fill out my contact form, score them and add high-quality ones to Salesforce.",
          timeToCreate: "2.2 min",
          icon: <Users className="w-6 h-6 text-green-400" />
        }
      ]
    },
    {
      title: "Legal & Compliance",
      category: "Legal",
      cases: [
        {
          name: "Contract Review Assistant",
          description: "Scans contracts for key terms and flags potential issues for review.",
          prompt: "Review new contracts for standard clauses and highlight any unusual terms.",
          timeToCreate: "2.5 min",
          icon: <FileText className="w-6 h-6 text-orange-400" />
        },
        {
          name: "Compliance Alert System",
          description: "Monitors regulatory updates and sends relevant changes to your team.",
          prompt: "Watch for SEC filing updates relevant to our industry and email the legal team.",
          timeToCreate: "1.8 min",
          icon: <FileText className="w-6 h-6 text-orange-400" />
        }
      ]
    },
    {
      title: "Finance & Operations",
      category: "Finance",
      cases: [
        {
          name: "Expense Report Organizer",
          description: "Automatically categorizes receipts and creates monthly expense reports.",
          prompt: "Organize my email receipts by category and create monthly expense summaries in Google Sheets.",
          timeToCreate: "1.3 min",
          icon: <DollarSign className="w-6 h-6 text-green-400" />
        },
        {
          name: "Invoice Payment Tracker",
          description: "Monitors outstanding invoices and sends gentle payment reminders.",
          prompt: "Track overdue invoices and send friendly payment reminders after 30 days.",
          timeToCreate: "2 min",
          icon: <DollarSign className="w-6 h-6 text-emerald-400" />
        }
      ]
    },
    {
      title: "Healthcare & Wellness",
      category: "Healthcare",
      cases: [
        {
          name: "Patient Appointment Coordinator",
          description: "Schedules follow-up appointments and sends treatment reminders to patients.",
          prompt: "Schedule follow-up appointments for discharged patients and send medication reminders.",
          timeToCreate: "2.1 min",
          icon: <Heart className="w-6 h-6 text-orange-400" />
        },
        {
          name: "Wellness Check-in Assistant",
          description: "Sends weekly wellness surveys and compiles results for health tracking.",
          prompt: "Send weekly wellness check-ins to patients and summarize responses for review.",
          timeToCreate: "1.6 min",
          icon: <Heart className="w-6 h-6 text-red-400" />
        }
      ]
    },
    {
      title: "Education & Coaching",
      category: "Education",
      cases: [
        {
          name: "Student Progress Monitor",
          description: "Tracks assignment submissions and sends progress reports to parents.",
          prompt: "Monitor student assignment submissions and email parents weekly progress updates.",
          timeToCreate: "1.9 min",
          icon: <Brain className="w-6 h-6 text-orange-400" />
        },
        {
          name: "Course Content Organizer",
          description: "Automatically organizes lecture notes and creates study guides for students.",
          prompt: "Organize my lecture recordings into study guides and share them with students.",
          timeToCreate: "2 min",
          icon: <Brain className="w-6 h-6 text-indigo-400" />
        }
      ]
    },
    {
      title: "Project Management",
      category: "Operations",
      cases: [
        {
          name: "Daily Standup Summarizer",
          description: "Collects team updates and creates formatted standup reports for stakeholders.",
          prompt: "Collect daily team updates from Slack and create formatted reports for management.",
          timeToCreate: "1.5 min",
          icon: <Calendar className="w-6 h-6 text-orange-400" />
        },
        {
          name: "Deadline Alert System",
          description: "Monitors project timelines and sends proactive deadline reminders.",
          prompt: "Track project deadlines in Asana and send team reminders 3 days before due dates.",
          timeToCreate: "1.7 min",
          icon: <Calendar className="w-6 h-6 text-orange-400" />
        }
      ]
    }
  ];

  const categories = ["All", "Marketing", "Sales", "Legal", "Finance", "Healthcare", "Education", "Operations"];

  const filteredSections = selectedCategory === "All"
    ? useCaseSections
    : useCaseSections.filter(section => section.category === selectedCategory);

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

      {/* Hero Section */}
      <section className="relative z-10 py-8 md:py-10">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-black mb-4 leading-tight">
              <span className="text-orange-400">
                Real-World Automations
              </span>
              <br />
              <span className="text-white">Built in Minutes</span>
            </h1>

            <p className="text-base md:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
              See how AgentsPilot powers automations across every industry — no coding needed, just natural language.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Category Filter */}
      <section className="relative z-10 py-6">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-5 py-2 font-medium text-sm transition-all duration-300 ${
                  selectedCategory === category
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                    : 'bg-zinc-800 text-slate-300 hover:bg-zinc-700 border border-zinc-700'
                }`}
              >
                {category}
              </button>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Use Cases Grid */}
      <section className="relative z-10 py-4 md:py-6">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            layout
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {filteredSections.flatMap((section, sectionIndex) =>
              section.cases.map((useCase, caseIndex) => (
                <motion.div
                  key={`${sectionIndex}-${caseIndex}`}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className="group bg-zinc-900/80 backdrop-blur-xl rounded-xl p-5 border border-white/10 hover:border-orange-400/30 transition-all duration-300"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-2.5 bg-white/5 rounded-lg border border-white/10">
                      {useCase.icon}
                    </div>
                    <div className="px-2.5 py-1 bg-green-500/20 text-green-300 rounded-md text-xs font-medium border border-green-500/30">
                      {useCase.timeToCreate}
                    </div>
                  </div>

                  {/* Title and Description */}
                  <h3 className="text-base md:text-lg font-bold mb-2 text-white group-hover:text-orange-400 transition-colors">
                    {useCase.name}
                  </h3>

                  <p className="text-sm text-slate-400 mb-4 leading-relaxed">
                    {useCase.description}
                  </p>

                  {/* Example Prompt */}
                  <div className="bg-zinc-800/60 rounded-lg p-3 border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                      <span className="text-[10px] font-semibold text-slate-500 tracking-wide">EXAMPLE</span>
                    </div>
                    <p className="text-slate-300 text-xs leading-relaxed italic">
                      "{useCase.prompt}"
                    </p>
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative z-10 py-10 md:py-14">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-2xl rounded-3xl p-8 md:p-12 border border-white/20 text-center">
              <h2 className="text-2xl md:text-3xl font-black mb-3">
                Ready to Build
                <br />
                <span className="text-orange-400">
                  Your First Agent?
                </span>
              </h2>
              <p className="text-base md:text-lg text-slate-300 mb-6 max-w-2xl mx-auto">
                Join thousands of professionals automating their work in minutes, not hours.
              </p>

              <Link
                href="/signup"
                className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 font-bold text-sm hover:shadow-2xl hover:shadow-orange-500/50 transition flex items-center gap-2 mx-auto"
              >
                Start Building Now
                <ArrowRight className="w-5 h-5" />
              </Link>

              <div className="flex items-center justify-center gap-6 mt-6 text-xs md:text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-orange-400" />
                  <span>Free during beta</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-orange-400" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-orange-400" />
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

export default UseCasesPage;