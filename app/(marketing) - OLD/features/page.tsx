'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Sparkles,
  Link as LinkIcon,
  BarChart3,
  Lock,
  Zap,
  Paintbrush,
  Brain,
  Users,
  Code,
  TrendingUp,
  FileCheck,
  Calendar,
  Mail,
  FileText,
  DollarSign,
  Heart,
  CheckCircle,
  ArrowRight
} from 'lucide-react'
import { SiNotion, SiSalesforce, SiStripe } from 'react-icons/si'
import { PluginIcon } from '@/components/PluginIcon'

interface Feature {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  category: string
  benefits: string[]
  technical: boolean
}

interface UseCase {
  name: string
  description: string
  prompt: string
  timeToCreate: string
  icon: React.ReactNode
  category: string
}

export default function FeaturesPage() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null)
  const [selectedUseCaseCategory, setSelectedUseCaseCategory] = useState<string>("All")

  const features: Feature[] = [
    {
      id: 'natural-language',
      title: 'Natural Language Processing',
      description: 'Describe your automation needs in plain English. Our advanced NLP understands context, intent, and business requirements.',
      icon: <MessageSquare className="w-8 h-8 text-blue-400" />,
      category: 'AI Core',
      benefits: [
        'No coding required - use everyday language',
        'Context-aware understanding of business processes',
        'Intelligent interpretation of complex requirements',
        'Multi-language support for global teams'
      ],
      technical: false
    },
    {
      id: 'intelligent-workflows',
      title: 'Intelligent Workflow Generation',
      description: 'AI automatically designs and optimizes workflows based on your descriptions, learning from patterns and best practices.',
      icon: <Sparkles className="w-8 h-8 text-purple-400" />,
      category: 'AI Core',
      benefits: [
        'Automatic workflow optimization',
        'Best practice recommendations',
        'Dynamic adaptation to changing requirements',
        'Error handling and recovery mechanisms'
      ],
      technical: false
    },
    {
      id: 'flexible-scheduling',
      title: 'Flexible Execution',
      description: 'Agents can be triggered on demand for immediate execution or scheduled to run automatically at specified times.',
      icon: <Calendar className="w-8 h-8 text-green-400" />,
      category: 'AI Core',
      benefits: [
        'On-demand execution for instant results',
        'Schedule agents to run at specific times',
        'Automatic timezone conversion',
        'Recurring workflows and tasks'
      ],
      technical: false
    },
    {
      id: 'intelligent-routing',
      title: 'Smart Decision Routing',
      description: 'AI-powered decision trees that route tasks based on content, priority, sentiment, and business rules.',
      icon: <Brain className="w-8 h-8 text-orange-400" />,
      category: 'AI Core',
      benefits: [
        'Intelligent content analysis',
        'Priority-based routing',
        'Sentiment and tone detection',
        'Dynamic rule adaptation'
      ],
      technical: false
    },
    {
      id: 'enterprise-integrations',
      title: 'Enterprise Integrations',
      description: 'Connect to 500+ business applications including CRM, ERP, communication tools, and databases with pre-built connectors.',
      icon: <LinkIcon className="w-8 h-8 text-blue-400" />,
      category: 'Integrations',
      benefits: [
        'Pre-built connectors for popular platforms',
        'Real-time data synchronization',
        'Secure authentication protocols',
        'Custom API integration support'
      ],
      technical: true
    },
    {
      id: 'api-platform',
      title: 'Developer API Platform',
      description: 'Comprehensive REST APIs with SDKs, webhooks, and extensive documentation for custom integrations.',
      icon: <Code className="w-8 h-8 text-purple-400" />,
      category: 'Integrations',
      benefits: [
        'RESTful API with full documentation',
        'SDKs for popular languages',
        'Webhook support for real-time events',
        'GraphQL endpoint for flexible queries'
      ],
      technical: true
    },
    {
      id: 'real-time-monitoring',
      title: 'Real-time Monitoring',
      description: 'Track agent performance, execution metrics, and system health with comprehensive dashboards and alerting.',
      icon: <BarChart3 className="w-8 h-8 text-green-400" />,
      category: 'Operations',
      benefits: [
        'Live performance metrics',
        'Intelligent alerting system',
        'Detailed execution logs',
        'Predictive failure detection'
      ],
      technical: false
    },
    {
      id: 'analytics-insights',
      title: 'Advanced Analytics',
      description: 'Deep insights into automation performance, cost savings, and efficiency gains with predictive analytics.',
      icon: <TrendingUp className="w-8 h-8 text-orange-400" />,
      category: 'Operations',
      benefits: [
        'ROI and cost savings tracking',
        'Performance trend analysis',
        'Predictive maintenance alerts',
        'Custom reporting and dashboards'
      ],
      technical: false
    },
    {
      id: 'scheduling-automation',
      title: 'Smart Scheduling',
      description: 'Advanced scheduling capabilities with timezone support, recurring tasks, and intelligent time optimization.',
      icon: <Calendar className="w-8 h-8 text-blue-400" />,
      category: 'Operations',
      benefits: [
        'Flexible scheduling with cron support',
        'Automatic timezone conversion',
        'Recurring workflows and tasks',
        'Peak time optimization'
      ],
      technical: false
    },
    {
      id: 'enterprise-security',
      title: 'Enterprise Security',
      description: 'Bank-grade security with end-to-end encryption, SOC 2 compliance, and granular access controls.',
      icon: <Lock className="w-8 h-8 text-purple-400" />,
      category: 'Security',
      benefits: [
        'End-to-end encryption',
        'SOC 2 Type II compliance',
        'Role-based access control',
        'Audit trails and compliance reporting'
      ],
      technical: true
    },
    {
      id: 'compliance-framework',
      title: 'Compliance Framework',
      description: 'Built-in compliance tools for GDPR, HIPAA, SOX, and other regulatory requirements with automated reporting.',
      icon: <FileCheck className="w-8 h-8 text-green-400" />,
      category: 'Security',
      benefits: [
        'GDPR, HIPAA, SOX compliance tools',
        'Automated compliance reporting',
        'Data retention policies',
        'Audit trail generation'
      ],
      technical: true
    },
    {
      id: 'scalable-architecture',
      title: 'Auto-scaling Infrastructure',
      description: 'Cloud-native architecture that automatically scales to handle millions of operations with 99.9% uptime guarantee.',
      icon: <Zap className="w-8 h-8 text-orange-400" />,
      category: 'Infrastructure',
      benefits: [
        'Automatic scaling based on demand',
        '99.9% uptime SLA',
        'Global edge deployment',
        'Load balancing and redundancy'
      ],
      technical: true
    },
    {
      id: 'visual-builder',
      title: 'Visual Workflow Builder',
      description: 'Drag-and-drop interface for complex workflows with real-time preview and testing capabilities.',
      icon: <Paintbrush className="w-8 h-8 text-blue-400" />,
      category: 'User Experience',
      benefits: [
        'Intuitive drag-and-drop interface',
        'Real-time workflow preview',
        'Built-in testing and debugging',
        'Version control and rollback'
      ],
      technical: false
    },
    {
      id: 'collaboration-tools',
      title: 'Team Collaboration',
      description: 'Built-in collaboration features with shared workspaces, role management, and approval workflows.',
      icon: <Users className="w-8 h-8 text-purple-400" />,
      category: 'User Experience',
      benefits: [
        'Shared team workspaces',
        'Granular permission management',
        'Approval and review workflows',
        'Activity tracking and notifications'
      ],
      technical: false
    }
  ]

  const useCases: UseCase[] = [
    {
      name: "Social Media Scheduler",
      description: "Automatically posts your content across platforms and tracks engagement.",
      prompt: "Post my blog articles to LinkedIn and Twitter, then send me weekly engagement reports.",
      timeToCreate: "2 min",
      icon: <TrendingUp className="w-6 h-6 text-blue-400" />,
      category: "Marketing"
    },
    {
      name: "Campaign Performance Tracker",
      description: "Monitors ad spend and performance, sending alerts when targets are hit.",
      prompt: "Track my Google Ads spend daily and alert me if any campaign exceeds $500.",
      timeToCreate: "1.5 min",
      icon: <TrendingUp className="w-6 h-6 text-purple-400" />,
      category: "Marketing"
    },
    {
      name: "Client Follow-Up Assistant",
      description: "Sends weekly summaries of unread client emails and drafts personalized follow-ups.",
      prompt: "Summarize my unread client emails and draft polite follow-up replies.",
      timeToCreate: "1.7 min",
      icon: <Mail className="w-6 h-6 text-green-400" />,
      category: "Sales"
    },
    {
      name: "Lead Qualification Bot",
      description: "Automatically scores new leads and adds qualified prospects to your CRM.",
      prompt: "When new leads fill out my contact form, score them and add high-quality ones to Salesforce.",
      timeToCreate: "2.2 min",
      icon: <Users className="w-6 h-6 text-orange-400" />,
      category: "Sales"
    },
    {
      name: "Contract Review Assistant",
      description: "Scans contracts for key terms and flags potential issues for review.",
      prompt: "Review new contracts for standard clauses and highlight any unusual terms.",
      timeToCreate: "2.5 min",
      icon: <FileText className="w-6 h-6 text-blue-400" />,
      category: "Legal"
    },
    {
      name: "Compliance Alert System",
      description: "Monitors regulatory updates and sends relevant changes to your team.",
      prompt: "Watch for SEC filing updates relevant to our industry and email the legal team.",
      timeToCreate: "1.8 min",
      icon: <FileText className="w-6 h-6 text-purple-400" />,
      category: "Legal"
    },
    {
      name: "Expense Report Organizer",
      description: "Automatically categorizes receipts and creates monthly expense reports.",
      prompt: "Organize my email receipts by category and create monthly expense summaries in Google Sheets.",
      timeToCreate: "1.3 min",
      icon: <DollarSign className="w-6 h-6 text-green-400" />,
      category: "Finance"
    },
    {
      name: "Invoice Payment Tracker",
      description: "Monitors outstanding invoices and sends gentle payment reminders.",
      prompt: "Track overdue invoices and send friendly payment reminders after 30 days.",
      timeToCreate: "2 min",
      icon: <DollarSign className="w-6 h-6 text-orange-400" />,
      category: "Finance"
    },
    {
      name: "Patient Appointment Coordinator",
      description: "Schedules follow-up appointments and sends treatment reminders to patients.",
      prompt: "Schedule follow-up appointments for discharged patients and send medication reminders.",
      timeToCreate: "2.1 min",
      icon: <Heart className="w-6 h-6 text-blue-400" />,
      category: "Healthcare"
    },
    {
      name: "Wellness Check-in Assistant",
      description: "Sends weekly wellness surveys and compiles results for health tracking.",
      prompt: "Send weekly wellness check-ins to patients and summarize responses for review.",
      timeToCreate: "1.6 min",
      icon: <Heart className="w-6 h-6 text-purple-400" />,
      category: "Healthcare"
    },
    {
      name: "Student Progress Monitor",
      description: "Tracks assignment submissions and sends progress reports to parents.",
      prompt: "Monitor student assignment submissions and email parents weekly progress updates.",
      timeToCreate: "1.9 min",
      icon: <Brain className="w-6 h-6 text-green-400" />,
      category: "Education"
    },
    {
      name: "Course Content Organizer",
      description: "Automatically organizes lecture notes and creates study guides for students.",
      prompt: "Organize my lecture recordings into study guides and share them with students.",
      timeToCreate: "2 min",
      icon: <Brain className="w-6 h-6 text-orange-400" />,
      category: "Education"
    },
    {
      name: "Daily Standup Summarizer",
      description: "Collects team updates and creates formatted standup reports for stakeholders.",
      prompt: "Collect daily team updates from Slack and create formatted reports for management.",
      timeToCreate: "1.5 min",
      icon: <Calendar className="w-6 h-6 text-blue-400" />,
      category: "Operations"
    },
    {
      name: "Deadline Alert System",
      description: "Monitors project timelines and sends proactive deadline reminders.",
      prompt: "Track project deadlines in Asana and send team reminders 3 days before due dates.",
      timeToCreate: "1.7 min",
      icon: <Calendar className="w-6 h-6 text-purple-400" />,
      category: "Operations"
    }
  ]

  const featureCategories = ['all', 'AI Core', 'Integrations', 'Operations', 'Security', 'Infrastructure', 'User Experience']
  const useCaseCategories = ["All", "Marketing", "Sales", "Legal", "Finance", "Healthcare", "Education", "Operations"]

  const filteredFeatures = features.filter(feature =>
    activeCategory === 'all' || feature.category === activeCategory
  )

  const filteredUseCases = selectedUseCaseCategory === "All"
    ? useCases
    : useCases.filter(useCase => useCase.category === selectedUseCaseCategory)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
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
                  Powerful AI Features
                </span>
                <span className="text-white block">
                  Built for Everyone
                </span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-base md:text-lg text-slate-300 max-w-4xl mx-auto leading-relaxed"
            >
              Everything you need to build, deploy, and scale intelligent automation across your organization.
              From simple workflows to enterprise-grade solutions.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-wrap items-center justify-center gap-4 pt-4 border-t border-white/10 text-sm text-slate-400"
            >
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span>No coding required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span>500+ integrations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span>Enterprise security</span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Platform Features Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black mb-6">
              <span className="text-orange-400">
                Platform Capabilities
              </span>
            </h2>
            <p className="text-base md:text-lg text-slate-300 max-w-3xl mx-auto mb-8">
              Comprehensive features designed for businesses of all sizes
            </p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              className="flex flex-wrap justify-center gap-3"
            >
              {featureCategories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-4 py-2 font-medium text-sm transition-all duration-300 ${
                    activeCategory === category
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/50'
                      : 'bg-zinc-800 text-slate-300 border border-zinc-700 hover:bg-zinc-700 hover:border-orange-500/30'
                  }`}
                >
                  {category === 'all' ? 'All Features' : category}
                </button>
              ))}
            </motion.div>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredFeatures.map((feature, index) => (
              <motion.div
                key={feature.id}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="relative group cursor-pointer"
                onClick={() => setSelectedFeature(selectedFeature === feature.id ? null : feature.id)}
              >
                <div className={`bg-zinc-900/90 backdrop-blur-xl p-6 border transition-all duration-300 h-full flex flex-col ${
                  selectedFeature === feature.id
                    ? 'border-orange-400/50'
                    : 'border-zinc-800 hover:border-orange-400/30'
                }`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center">
                      <div className="mr-3">{feature.icon}</div>
                      <div>
                        <h3 className="text-lg font-bold text-white">{feature.title}</h3>
                        <span className="text-xs px-2 py-1 bg-orange-500/20 text-orange-300 border border-orange-400/30">
                          {feature.category}
                        </span>
                      </div>
                    </div>
                    {feature.technical && (
                      <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 border border-blue-400/30">
                        Technical
                      </span>
                    )}
                  </div>

                  <p className="text-gray-200 mb-4 text-sm leading-relaxed flex-grow">
                    {feature.description}
                  </p>

                  <AnimatePresence>
                    {selectedFeature === feature.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="space-y-2 border-t border-zinc-700 pt-4"
                      >
                        <div className="text-sm font-medium text-white mb-2">Key Benefits:</div>
                        {feature.benefits.map((benefit, benefitIndex) => (
                          <motion.div
                            key={benefitIndex}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3, delay: benefitIndex * 0.1 }}
                            className="flex items-start text-sm"
                          >
                            <div className="w-2 h-2 bg-green-400 rounded-full mr-3 mt-1.5 flex-shrink-0"></div>
                            <span className="text-gray-300">{benefit}</span>
                          </motion.div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="mt-4 text-orange-300 text-sm font-medium">
                    {selectedFeature === feature.id ? 'Click to collapse' : 'Click for details'}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Integration Showcase */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black mb-6">
              <span className="text-orange-400">
                Enterprise Integrations
              </span>
            </h2>
            <p className="text-base md:text-lg text-slate-300">Connect with the tools your team already uses</p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 mb-12">
            {[
              { name: 'Slack', icon: <PluginIcon pluginId="slack" className="w-8 h-8" alt="Slack" /> },
              { name: 'Gmail', icon: <PluginIcon pluginId="google-mail" className="w-8 h-8" alt="Gmail" /> },
              { name: 'Notion', icon: <SiNotion className="w-8 h-8 text-white" /> },
              { name: 'Google Drive', icon: <PluginIcon pluginId="google-drive" className="w-8 h-8" alt="Google Drive" /> },
              { name: 'Google Calendar', icon: <PluginIcon pluginId="google-calendar" className="w-8 h-8" alt="Google Calendar" /> },
              { name: 'HubSpot', icon: <PluginIcon pluginId="hubspot" className="w-8 h-8" alt="HubSpot" /> },
              { name: 'Facebook', icon: <PluginIcon pluginId="facebook" className="w-8 h-8" alt="Facebook" /> },
              { name: 'Instagram', icon: <PluginIcon pluginId="instagram" className="w-8 h-8" alt="Instagram" /> },
              { name: 'Google Ads', icon: <PluginIcon pluginId="google-ads" className="w-8 h-8" alt="Google Ads" /> },
              { name: 'Meta Ads', icon: <PluginIcon pluginId="meta-ads" className="w-8 h-8" alt="Meta Ads" /> },
              { name: 'Salesforce', icon: <SiSalesforce className="w-8 h-8 text-[#00A1E0]" /> },
              { name: 'Stripe', icon: <SiStripe className="w-8 h-8 text-[#635BFF]" /> }
            ].map((integration, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
              >
                <div className="bg-zinc-900/90 backdrop-blur-xl p-4 border border-zinc-800 hover:border-orange-400/30 transition-all duration-300 text-center">
                  <div className="mb-2">{integration.icon}</div>
                  <div className="text-sm font-medium text-white">{integration.name}</div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <p className="text-slate-300">And 500+ more integrations available</p>
          </motion.div>
        </div>
      </section>

      {/* Real-World Use Cases Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black mb-6">
              <span className="text-orange-400">
                Real-World Use Cases
              </span>
            </h2>
            <p className="text-base md:text-lg text-slate-300 max-w-3xl mx-auto mb-8">
              See how AgentsPilot powers automations across every industry - no coding needed, just natural language
            </p>

            <div className="flex flex-wrap justify-center gap-3">
              {useCaseCategories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedUseCaseCategory(category)}
                  className={`px-4 py-2 font-medium text-sm transition-all duration-300 ${
                    selectedUseCaseCategory === category
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                      : 'bg-zinc-800 text-slate-300 border border-zinc-700 hover:bg-zinc-700'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUseCases.map((useCase, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="group bg-zinc-900/90 backdrop-blur-xl p-6 border border-zinc-800 hover:border-orange-400/30 transition-all duration-300"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2.5 bg-white/5 border border-zinc-700">
                    {useCase.icon}
                  </div>
                  <div className="px-2.5 py-1 bg-green-500/20 text-green-300 text-xs font-medium border border-green-500/30">
                    {useCase.timeToCreate}
                  </div>
                </div>

                <h3 className="text-base md:text-lg font-bold mb-2 text-white group-hover:text-orange-400 transition-colors">
                  {useCase.name}
                </h3>

                <p className="text-sm text-slate-400 mb-4 leading-relaxed">
                  {useCase.description}
                </p>

                <div className="bg-zinc-800/60 p-3 border border-zinc-700">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                    <span className="text-[10px] font-semibold text-slate-500 tracking-wide">EXAMPLE</span>
                  </div>
                  <p className="text-slate-300 text-xs leading-relaxed italic">
                    "{useCase.prompt}"
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950">
        <div className="max-w-4xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-zinc-900/95 backdrop-blur-2xl p-8 md:p-12 border border-zinc-800 text-center space-y-8">
              <div className="space-y-2">
                <h3 className="text-2xl md:text-3xl font-bold text-white">Ready to Get Started?</h3>
                <p className="text-sm md:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
                  Start with 10,417 free Pilot Credits. No credit card required.
                  Build your first agent in minutes.
                </p>
              </div>

              <Link
                href="/signup"
                className="group relative px-6 py-2.5 bg-orange-500 font-bold text-sm text-white hover:shadow-xl hover:shadow-orange-500/50 hover:bg-orange-600 transition-all duration-300 inline-flex items-center justify-center gap-2"
              >
                Start Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>

              <div className="flex flex-wrap items-center justify-center gap-6 text-xs md:text-sm text-slate-400">
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
  )
}
