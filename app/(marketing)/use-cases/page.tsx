'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';

const UseCasesPage = () => {
  const [hoveredCard, setHoveredCard] = useState(null);

  // Icon components for visual appeal
  const EnvelopeIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" className="fill-blue-400"/>
      <path d="m22 6-10 7L2 6" stroke="white" strokeWidth="2" fill="none"/>
    </svg>
  );

  const ChartIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" fill="none"/>
      <path d="M18 17l-5-5-3 3-4-4" stroke="currentColor" strokeWidth="2" fill="none" className="text-purple-400"/>
    </svg>
  );

  const DocumentIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" className="fill-green-400"/>
      <polyline points="14,2 14,8 20,8" stroke="white" strokeWidth="2" fill="none"/>
    </svg>
  );

  const CalendarIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" className="fill-blue-400"/>
    </svg>
  );

  const BrainIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M12 3C8.5 3 6 5.5 6 8.5c0 1.5-.7 2.8-1.8 3.5C3.5 12.5 3 13.7 3 15c0 2.8 2.2 5 5 5h8c2.8 0 5-2.2 5-5 0-1.3-.5-2.5-1.2-3-.5-.3-1.1-.7-1.4-1.2-.6-.9-1.4-1.8-1.4-2.8 0-3-2.5-5.5-6-5.5z" className="fill-purple-400"/>
      <circle cx="9" cy="12" r="1.5" className="fill-white"/>
      <circle cx="15" cy="12" r="1.5" className="fill-white"/>
    </svg>
  );

  const HeartIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" className="fill-pink-400"/>
    </svg>
  );

  const UserIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" fill="none" className="text-blue-400"/>
      <circle cx="12" cy="7" r="4" className="fill-blue-400"/>
    </svg>
  );

  const MoneyIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" className="fill-green-400"/>
      <path d="M12 6v12M15 9a3 3 0 1 0 0 6" stroke="white" strokeWidth="2" fill="none"/>
    </svg>
  );

  const useCaseSections = [
    {
      title: "Marketing & Social Media",
      gradient: "from-blue-500/20 to-purple-500/20",
      cases: [
        {
          name: "Social Media Scheduler",
          description: "Automatically posts your content across platforms and tracks engagement.",
          prompt: "Post my blog articles to LinkedIn and Twitter, then send me weekly engagement reports.",
          timeToCreate: "2 minutes",
          icon: <ChartIcon />
        },
        {
          name: "Campaign Performance Tracker",
          description: "Monitors ad spend and performance, sending alerts when targets are hit.",
          prompt: "Track my Google Ads spend daily and alert me if any campaign exceeds $500.",
          timeToCreate: "1 minute 30 seconds",
          icon: <ChartIcon />
        }
      ]
    },
    {
      title: "Sales & CRM",
      gradient: "from-green-500/20 to-blue-500/20",
      cases: [
        {
          name: "Client Follow-Up Assistant",
          description: "Sends weekly summaries of unread client emails and drafts personalized follow-ups.",
          prompt: "Summarize my unread client emails and draft polite follow-up replies.",
          timeToCreate: "1 minute 45 seconds",
          icon: <EnvelopeIcon />
        },
        {
          name: "Lead Qualification Bot",
          description: "Automatically scores new leads and adds qualified prospects to your CRM.",
          prompt: "When new leads fill out my contact form, score them and add high-quality ones to Salesforce.",
          timeToCreate: "2 minutes 15 seconds",
          icon: <UserIcon />
        }
      ]
    },
    {
      title: "Legal & Compliance",
      gradient: "from-purple-500/20 to-pink-500/20",
      cases: [
        {
          name: "Contract Review Assistant",
          description: "Scans contracts for key terms and flags potential issues for review.",
          prompt: "Review new contracts for standard clauses and highlight any unusual terms.",
          timeToCreate: "2 minutes 30 seconds",
          icon: <DocumentIcon />
        },
        {
          name: "Compliance Alert System",
          description: "Monitors regulatory updates and sends relevant changes to your team.",
          prompt: "Watch for SEC filing updates relevant to our industry and email the legal team.",
          timeToCreate: "1 minute 50 seconds",
          icon: <DocumentIcon />
        }
      ]
    },
    {
      title: "Finance & Operations",
      gradient: "from-green-500/20 to-emerald-500/20",
      cases: [
        {
          name: "Expense Report Organizer",
          description: "Automatically categorizes receipts and creates monthly expense reports.",
          prompt: "Organize my email receipts by category and create monthly expense summaries in Google Sheets.",
          timeToCreate: "1 minute 20 seconds",
          icon: <MoneyIcon />
        },
        {
          name: "Invoice Payment Tracker",
          description: "Monitors outstanding invoices and sends gentle payment reminders.",
          prompt: "Track overdue invoices and send friendly payment reminders after 30 days.",
          timeToCreate: "2 minutes",
          icon: <MoneyIcon />
        }
      ]
    },
    {
      title: "Healthcare & Wellness",
      gradient: "from-pink-500/20 to-red-500/20",
      cases: [
        {
          name: "Patient Appointment Coordinator",
          description: "Schedules follow-up appointments and sends treatment reminders to patients.",
          prompt: "Schedule follow-up appointments for discharged patients and send medication reminders.",
          timeToCreate: "2 minutes 10 seconds",
          icon: <HeartIcon />
        },
        {
          name: "Wellness Check-in Assistant",
          description: "Sends weekly wellness surveys and compiles results for health tracking.",
          prompt: "Send weekly wellness check-ins to patients and summarize responses for review.",
          timeToCreate: "1 minute 40 seconds",
          icon: <HeartIcon />
        }
      ]
    },
    {
      title: "Education & Coaching",
      gradient: "from-blue-500/20 to-indigo-500/20",
      cases: [
        {
          name: "Student Progress Monitor",
          description: "Tracks assignment submissions and sends progress reports to parents.",
          prompt: "Monitor student assignment submissions and email parents weekly progress updates.",
          timeToCreate: "1 minute 55 seconds",
          icon: <BrainIcon />
        },
        {
          name: "Course Content Organizer",
          description: "Automatically organizes lecture notes and creates study guides for students.",
          prompt: "Organize my lecture recordings into study guides and share them with students.",
          timeToCreate: "2 minutes 5 seconds",
          icon: <BrainIcon />
        }
      ]
    },
    {
      title: "Project Management",
      gradient: "from-purple-500/20 to-blue-500/20",
      cases: [
        {
          name: "Daily Standup Summarizer",
          description: "Collects team updates and creates formatted standup reports for stakeholders.",
          prompt: "Collect daily team updates from Slack and create formatted reports for management.",
          timeToCreate: "1 minute 30 seconds",
          icon: <CalendarIcon />
        },
        {
          name: "Deadline Alert System",
          description: "Monitors project timelines and sends proactive deadline reminders.",
          prompt: "Track project deadlines in Asana and send team reminders 3 days before due dates.",
          timeToCreate: "1 minute 45 seconds",
          icon: <CalendarIcon />
        }
      ]
    }
  ];

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
      </div>

      {/* Hero Section */}
      <section className="relative z-10 pt-20 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h1 className="text-5xl md:text-6xl font-black mb-6 leading-tight">
              <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Real-World Automations
              </span>
              <br />
              <span className="text-white">Built in Minutes</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-slate-300 max-w-3xl mx-auto mb-8 leading-relaxed">
              See how AgentPilot powers automations across every industry — no coding needed, just natural language.
            </p>
            
            <div className="flex items-center justify-center gap-6 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span>No technical skills required</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                <span>Works with your existing tools</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                <span>Ready in under 3 minutes</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Use Cases Sections */}
      <section className="relative z-10 pb-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="space-y-16">
            {useCaseSections.map((section, sectionIndex) => (
              <motion.div
                key={sectionIndex}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: sectionIndex * 0.1 }}
              >
                {/* Section Header */}
                <div className="text-center mb-12">
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">
                    <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                      {section.title}
                    </span>
                  </h2>
                </div>

                {/* Use Case Cards */}
                <div className="grid md:grid-cols-2 gap-8">
                  {section.cases.map((useCase, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: index * 0.2 }}
                      onHoverStart={() => setHoveredCard(`${sectionIndex}-${index}`)}
                      onHoverEnd={() => setHoveredCard(null)}
                      className="group relative"
                    >
                      {/* Animated gradient border */}
                      <div className={`absolute -inset-0.5 bg-gradient-to-r ${section.gradient} rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500`} />
                      
                      {/* Card content */}
                      <div className="relative bg-slate-900/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 h-full">
                        {/* Icon and time badge */}
                        <div className="flex items-start justify-between mb-6">
                          <motion.div
                            animate={hoveredCard === `${sectionIndex}-${index}` ? {
                              scale: [1, 1.1, 1],
                              rotate: [0, 5, -5, 0]
                            } : {}}
                            transition={{ duration: 0.6 }}
                            className="p-3 bg-white/5 rounded-xl border border-white/10"
                          >
                            {useCase.icon}
                          </motion.div>
                          <div className="px-3 py-1.5 bg-green-500/20 text-green-300 rounded-lg text-sm font-medium border border-green-500/30">
                            ⚡ {useCase.timeToCreate}
                          </div>
                        </div>

                        {/* Content */}
                        <h3 className="text-2xl font-bold mb-3 text-white group-hover:text-blue-300 transition-colors">
                          {useCase.name}
                        </h3>
                        
                        <p className="text-slate-400 mb-6 leading-relaxed">
                          {useCase.description}
                        </p>

                        {/* Example prompt */}
                        <div className="relative">
                          <div className="absolute -inset-3 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-xl blur-xl opacity-50"></div>
                          <div className="relative bg-slate-800/80 backdrop-blur-sm rounded-xl p-4 border border-white/5">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                              <span className="text-xs font-medium text-slate-500">EXAMPLE PROMPT</span>
                            </div>
                            <p className="text-slate-300 font-mono text-sm leading-relaxed italic">
                              "{useCase.prompt}"
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative z-10 py-24">
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
                Ready to Build
                <br />
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Your First Agent?
                </span>
              </h2>
              <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                Join thousands of professionals automating their work in minutes, not hours.
              </p>
              
              <button className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-bold text-lg hover:shadow-2xl hover:shadow-purple-500/50 transition flex items-center gap-2 mx-auto">
                Start Building Now
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              <div className="flex items-center justify-center gap-6 mt-8 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" fill="none"/>
                  </svg>
                  <span>Free during beta</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" fill="none"/>
                  </svg>
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" fill="none"/>
                  </svg>
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