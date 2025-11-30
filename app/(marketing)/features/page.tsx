'use client'

import React, { useState, useEffect } from 'react'
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
  Grid3x3,
  Calendar
} from 'lucide-react'
import { SiNotion, SiSalesforce, SiZoom, SiZapier, SiAmazon, SiStripe } from 'react-icons/si'
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

export default function FeaturesPage() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    setIsVisible(true)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const features: Feature[] = [
    {
      id: 'natural-language',
      title: 'Natural Language Processing',
      description: 'Describe your automation needs in plain English. Our advanced NLP understands context, intent, and business requirements.',
      icon: <MessageSquare className="w-8 h-8 text-orange-400" />,
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
      icon: <Sparkles className="w-8 h-8 text-orange-400" />,
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
      id: 'enterprise-integrations',
      title: 'Enterprise Integrations',
      description: 'Connect to 500+ business applications including CRM, ERP, communication tools, and databases with pre-built connectors.',
      icon: <LinkIcon className="w-8 h-8 text-orange-400" />,
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
      id: 'real-time-monitoring',
      title: 'Real-time Monitoring',
      description: 'Track agent performance, execution metrics, and system health with comprehensive dashboards and alerting.',
      icon: <BarChart3 className="w-8 h-8 text-orange-400" />,
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
      id: 'enterprise-security',
      title: 'Enterprise Security',
      description: 'Bank-grade security with end-to-end encryption, SOC 2 compliance, and granular access controls.',
      icon: <Lock className="w-8 h-8 text-orange-400" />,
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
      icon: <Paintbrush className="w-8 h-8 text-orange-400" />,
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
      id: 'collaboration-tools',
      title: 'Team Collaboration',
      description: 'Built-in collaboration features with shared workspaces, role management, and approval workflows.',
      icon: <Users className="w-8 h-8 text-orange-400" />,
      category: 'User Experience',
      benefits: [
        'Shared team workspaces',
        'Granular permission management',
        'Approval and review workflows',
        'Activity tracking and notifications'
      ],
      technical: false
    },
    {
      id: 'api-platform',
      title: 'Developer API Platform',
      description: 'Comprehensive REST APIs with SDKs, webhooks, and extensive documentation for custom integrations.',
      icon: <Code className="w-8 h-8 text-orange-400" />,
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
      id: 'compliance-framework',
      title: 'Compliance Framework',
      description: 'Built-in compliance tools for GDPR, HIPAA, SOX, and other regulatory requirements with automated reporting.',
      icon: <FileCheck className="w-8 h-8 text-orange-400" />,
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
      id: 'scheduling-automation',
      title: 'Smart Scheduling',
      description: 'Advanced scheduling capabilities with timezone support, recurring tasks, and intelligent time optimization.',
      icon: <Calendar className="w-8 h-8 text-orange-400" />,
      category: 'Operations',
      benefits: [
        'Flexible scheduling with cron support',
        'Automatic timezone conversion',
        'Recurring workflows and tasks',
        'Peak time optimization'
      ],
      technical: false
    }
  ]

  const categories = ['all', 'AI Core', 'Integrations', 'Operations', 'Security', 'Infrastructure', 'User Experience']

  const filteredFeatures = features.filter(feature => 
    activeCategory === 'all' || feature.category === activeCategory
  )

  const coreFeatures = [
    ...features.filter(f => f.category === 'AI Core'),
    {
      id: 'flexible-scheduling',
      title: 'Flexible Execution',
      description: 'Agents can be triggered on demand for immediate execution or scheduled to run automatically at specified times.',
      icon: <Calendar className="w-8 h-8 text-orange-400" />,
      category: 'AI Core',
      benefits: [
        'On-demand execution for instant results',
        'Schedule agents to run at specific times'
      ],
      technical: false
    }
  ]
  const integrationFeatures = features.filter(f => f.category === 'Integrations')

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
            opacity: [0.2, 0.4, 0.3, 0.2]
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/8 rounded-full blur-3xl"
        />
      </div>


      <div className="relative z-10">
        {/* Hero Section - Same style as main page */}
        <section className="relative py-8 md:py-12 lg:py-14">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center mb-16"
            >
              <motion.h1
                className="text-3xl md:text-4xl lg:text-5xl font-black mb-4 leading-tight"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
              >
                <span className="text-orange-400">
                  Powerful AI Features
                </span>
                <br />
                <span className="text-white">Built for Everyone</span>
              </motion.h1>
              
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-base md:text-lg text-slate-300 max-w-3xl mx-auto mb-8 leading-relaxed"
              >
                Everything you need to build, deploy, and scale intelligent automation across your organization.
                From simple workflows to enterprise-grade solutions.
              </motion.p>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex flex-wrap justify-center gap-3 mb-12"
              >
                {categories.map((category, index) => (
                  <motion.button
                    key={category}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.7 + index * 0.1 }}
                    onClick={() => setActiveCategory(category)}
                    className={`px-4 py-2 rounded-full font-medium text-sm transition-all duration-300 ${
                      activeCategory === category
                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/50'
                        : 'bg-zinc-900/50 text-slate-300 border border-white/10 hover:bg-zinc-800/50 hover:border-orange-500/30 backdrop-blur-sm'
                    }`}
                  >
                    {category === 'all' ? 'All Features' : category}
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Core AI Features Highlight */}
        <section className="py-8 md:py-12 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl md:text-3xl font-bold mb-3">
                <span className="text-orange-400">
                  AI-Powered Core
                </span>
              </h2>
              <p className="text-base md:text-lg text-slate-400">The intelligent foundation that makes everything possible</p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {coreFeatures.map((feature, index) => (
                <motion.div 
                  key={feature.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.2 }}
                >
                  <div className="bg-zinc-900/90 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-lg h-full flex flex-col">
                    <div className="flex items-start space-x-4 flex-1">
                      <div className="flex-shrink-0">{feature.icon}</div>
                      <div className="flex-1 flex flex-col">
                        <h3 className="text-lg md:text-xl font-bold text-white mb-2">{feature.title}</h3>
                        <p className="text-sm md:text-base text-gray-200 mb-4 leading-relaxed flex-grow">{feature.description}</p>

                        <div className="space-y-2">
                          {feature.benefits.slice(0, 2).map((benefit, idx) => (
                            <div key={idx} className="flex items-center text-xs md:text-sm">
                              <div className="w-1.5 h-1.5 bg-green-400 rounded-full mr-2"></div>
                              <span className="text-gray-300">{benefit}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Feature Demo */}
        <section className="py-6 md:py-8 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-8"
            >
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                See It In Action
              </h2>
              <p className="text-base text-gray-200">Interactive demonstration of key platform capabilities</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-2xl overflow-hidden">
                {/* Animated background particles */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(6)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        x: [0, 100, 0],
                        y: [0, -50, 0],
                        opacity: [0.2, 0.5, 0.2],
                        scale: [1, 1.5, 1],
                      }}
                      transition={{
                        duration: 4 + i * 0.5,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.8
                      }}
                      className="absolute w-2 h-2 rounded-full bg-orange-400 blur-sm"
                      style={{
                        left: `${20 + i * 12}%`,
                        top: `${10 + i * 15}%`,
                      }}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
                  <div className="space-y-6">
                    <motion.h3 
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.2 }}
                      className="text-2xl font-bold text-white"
                    >
                      Natural Language to Automation
                    </motion.h3>
                    
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.4 }}
                      className="bg-zinc-800/50 rounded-xl p-6 border border-orange-500/30 relative overflow-hidden"
                    >
                      {/* Animated border glow */}
                      <motion.div
                        animate={{
                          opacity: [0.5, 1, 0.5],
                          scale: [1, 1.02, 1],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut"
                        }}
                        className="absolute inset-0 bg-orange-500/20 rounded-xl"
                      />
                      
                      <div className="relative">
                        <motion.div 
                          initial={{ opacity: 0 }}
                          whileInView={{ opacity: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.4, delay: 0.6 }}
                          className="text-sm text-gray-300 mb-2"
                        >
                          Input:
                        </motion.div>
                        
                        <div className="bg-zinc-800/30 rounded-lg p-4 border border-orange-400/30 mb-4 relative">
                          {/* Typing animation */}
                          <motion.div
                            initial={{ width: 0 }}
                            whileInView={{ width: "100%" }}
                            viewport={{ once: true }}
                            transition={{ duration: 2, delay: 0.8 }}
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-transparent via-orange-400/10 to-transparent"
                          />
                          
                          <motion.p 
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, delay: 1.2 }}
                            className="text-gray-200 italic relative z-10"
                          >
                            "Send me a Slack notification whenever a high-value lead completes our pricing calculator, 
                            and automatically add them to our VIP nurture sequence in HubSpot."
                          </motion.p>
                          
                          {/* Cursor animation */}
                          <motion.span
                            animate={{ opacity: [1, 0, 1] }}
                            transition={{ duration: 0.8, repeat: Infinity }}
                            className="inline-block w-0.5 h-4 bg-orange-400 ml-1"
                          />
                        </div>
                        
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6, delay: 1.6 }}
                          className="text-sm text-gray-300 mb-2"
                        >
                          AI Analysis:
                        </motion.div>
                        
                        <div className="space-y-2">
                          {[
                            { text: "Trigger: Pricing calculator completion", color: "bg-orange-400", delay: 1.8 },
                            { text: "Condition: High-value lead classification", color: "bg-orange-500", delay: 2.0 },
                            { text: "Actions: Slack notification + HubSpot automation", color: "bg-orange-600", delay: 2.2 }
                          ].map((item, idx) => (
                            <motion.div 
                              key={idx}
                              initial={{ opacity: 0, x: -20 }}
                              whileInView={{ opacity: 1, x: 0 }}
                              viewport={{ once: true }}
                              transition={{ duration: 0.4, delay: item.delay }}
                              className="flex items-center text-sm"
                            >
                              <motion.div 
                                initial={{ scale: 0 }}
                                whileInView={{ scale: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.3, delay: item.delay + 0.2, type: "spring" }}
                                className={`w-2 h-2 ${item.color} rounded-full mr-3`}
                              />
                              <span className="text-gray-200">{item.text}</span>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  <div className="space-y-6">
                    <motion.h3 
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.3 }}
                      className="text-2xl font-bold text-white"
                    >
                      Generated Workflow
                    </motion.h3>
                    
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: 0.5 }}
                      className="bg-gradient-to-br from-zinc-900/50 to-zinc-800/50 rounded-xl p-6 border border-orange-400/30 relative overflow-hidden"
                    >
                      {/* Animated flow lines */}
                      <motion.div
                        initial={{ pathLength: 0 }}
                        whileInView={{ pathLength: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 2, delay: 2.5 }}
                        className="absolute inset-0"
                      >
                        <svg className="w-full h-full" viewBox="0 0 300 200">
                          <motion.path
                            d="M 50 60 Q 150 80 250 120"
                            stroke="url(#gradient)"
                            strokeWidth="2"
                            fill="none"
                            initial={{ pathLength: 0 }}
                            whileInView={{ pathLength: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 2, delay: 2.5 }}
                          />
                          <defs>
                            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#fb923c" stopOpacity="0.6" />
                              <stop offset="50%" stopColor="#f97316" stopOpacity="0.8" />
                              <stop offset="100%" stopColor="#ea580c" stopOpacity="0.6" />
                            </linearGradient>
                          </defs>
                        </svg>
                      </motion.div>

                      <div className="space-y-4 relative z-10">
                        {[
                          {
                            step: "1",
                            title: "Monitor Pricing Calculator",
                            subtitle: "Webhook listener active",
                            color: "bg-orange-500",
                            delay: 2.6
                          },
                          {
                            step: "2",
                            title: "Evaluate Lead Score",
                            subtitle: "AI classification: High-value criteria",
                            color: "bg-orange-500",
                            delay: 2.8
                          },
                          {
                            step: "3",
                            title: "Execute Actions",
                            subtitle: "Slack + HubSpot integration",
                            color: "bg-orange-500",
                            delay: 3.0
                          }
                        ].map((step, index) => (
                          <motion.div 
                            key={index}
                            initial={{ opacity: 0, x: 30 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, delay: step.delay }}
                            className="flex items-center space-x-3"
                          >
                            <motion.div 
                              initial={{ scale: 0, rotate: -180 }}
                              whileInView={{ scale: 1, rotate: 0 }}
                              viewport={{ once: true }}
                              transition={{ duration: 0.4, delay: step.delay + 0.2, type: "spring" }}
                              className={`w-8 h-8 ${step.color} rounded-full flex items-center justify-center text-white text-sm font-bold relative`}
                            >
                              {step.step}
                              {/* Pulsing ring */}
                              <motion.div
                                animate={{
                                  scale: [1, 1.5, 1],
                                  opacity: [0.7, 0, 0.7],
                                }}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                  delay: step.delay + 0.5
                                }}
                                className={`absolute inset-0 ${step.color} rounded-full`}
                              />
                            </motion.div>
                            <div>
                              <motion.div 
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.4, delay: step.delay + 0.3 }}
                                className="font-medium text-white"
                              >
                                {step.title}
                              </motion.div>
                              <motion.div 
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.4, delay: step.delay + 0.4 }}
                                className="text-sm text-gray-300"
                              >
                                {step.subtitle}
                              </motion.div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      
                      {/* Progress bar */}
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 3.2 }}
                        className="mt-6"
                      >
                        <div className="w-full bg-zinc-700/50 rounded-full h-2 overflow-hidden">
                          <motion.div
                            initial={{ width: "0%" }}
                            whileInView={{ width: "100%" }}
                            viewport={{ once: true }}
                            transition={{ duration: 1.5, delay: 3.4, ease: "easeInOut" }}
                            className="h-full bg-orange-500 relative"
                          >
                            {/* Moving shine effect */}
                            <motion.div
                              animate={{ x: [-100, 200] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                              className="absolute inset-0 w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
                            />
                          </motion.div>
                        </div>
                      </motion.div>
                      
                      {/* Success message with confetti effect */}
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.8 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 4.5, type: "spring" }}
                        className="mt-6 p-3 bg-green-900/30 rounded-lg border border-green-500/30 relative overflow-hidden"
                      >
                        {/* Confetti particles */}
                        {[...Array(8)].map((_, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0, y: 0 }}
                            whileInView={{
                              opacity: [0, 1, 0],
                              scale: [0, 1, 0.5],
                              y: [0, -30, -60],
                              x: [0, (Math.random() - 0.5) * 60],
                              rotate: [0, Math.random() * 360]
                            }}
                            viewport={{ once: true }}
                            transition={{
                              duration: 1.2,
                              delay: 4.6 + i * 0.1,
                              ease: "easeOut"
                            }}
                            className={`absolute w-2 h-2 ${
                              i % 3 === 0 ? 'bg-green-400' : i % 3 === 1 ? 'bg-yellow-400' : 'bg-blue-400'
                            } rounded-full`}
                            style={{
                              left: `${20 + i * 8}%`,
                              top: '50%'
                            }}
                          />
                        ))}
                        
                        <motion.div 
                          initial={{ opacity: 0 }}
                          whileInView={{ opacity: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.4, delay: 4.7 }}
                          className="text-sm text-orange-300 font-medium relative z-10"
                        >
                          ✓ Workflow deployed and active
                        </motion.div>
                      </motion.div>
                    </motion.div>
                  </div>
                </div>

                {/* Data flow animation */}
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, delay: 5 }}
                  className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                >
                  {[...Array(3)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        scale: [0, 1.5, 0],
                        opacity: [0, 0.6, 0],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        delay: i * 0.7 + 5,
                        ease: "easeInOut"
                      }}
                      className="absolute w-4 h-4 bg-orange-400 rounded-full"
                    />
                  ))}
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* All Features Grid */}
        <section className="py-8 md:py-12 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                Complete Feature Set
              </h2>
              <p className="text-base md:text-lg text-gray-200">
                {filteredFeatures.length} {filteredFeatures.length === 1 ? 'feature' : 'features'}
                {activeCategory !== 'all' && ` in ${activeCategory}`}
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredFeatures.map((feature, index) => (
                <motion.div
                  key={feature.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className={`relative group cursor-pointer ${
                    selectedFeature === feature.id ? 'z-10' : ''
                  }`}
                  onClick={() => setSelectedFeature(selectedFeature === feature.id ? null : feature.id)}
                >
                  <div className={`bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 backdrop-blur-xl rounded-xl p-6 border transition-all duration-300 shadow-lg h-full flex flex-col ${
                    selectedFeature === feature.id
                      ? 'border-orange-400/50'
                      : 'border-white/10'
                  }`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="mr-3">{feature.icon}</div>
                        <div>
                          <h3 className="text-lg font-bold text-white">{feature.title}</h3>
                          <span className="text-xs px-2 py-1 bg-orange-500/20 text-orange-300 rounded-full border border-orange-400/30">
                            {feature.category}
                          </span>
                        </div>
                      </div>
                      {feature.technical && (
                        <span className="text-xs px-2 py-1 bg-amber-500/20 text-amber-300 rounded-full border border-amber-400/30">
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
                          className="space-y-2 border-t border-purple-500/30 pt-4"
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
        <section className="py-8 md:py-12 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                <span className="text-orange-400">
                  Enterprise Integrations
                </span>
              </h2>
              <p className="text-base md:text-lg text-gray-200">Connect with the tools your team already uses</p>
            </motion.div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 mb-12">
              {[
                {
                  name: 'Slack',
                  icon: <PluginIcon pluginId="slack" className="w-8 h-8" alt="Slack" />
                },
                {
                  name: 'Gmail',
                  icon: <PluginIcon pluginId="google-mail" className="w-8 h-8" alt="Gmail" />
                },
                {
                  name: 'Notion',
                  icon: <SiNotion className="w-8 h-8 text-white" />
                },
                {
                  name: 'Google Drive',
                  icon: <PluginIcon pluginId="google-drive" className="w-8 h-8" alt="Google Drive" />
                },
                {
                  name: 'Google Calendar',
                  icon: <PluginIcon pluginId="google-calendar" className="w-8 h-8" alt="Google Calendar" />
                },
                {
                  name: 'HubSpot',
                  icon: <PluginIcon pluginId="hubspot" className="w-8 h-8" alt="HubSpot" />
                },
                {
                  name: 'Facebook',
                  icon: <PluginIcon pluginId="facebook" className="w-8 h-8" alt="Facebook" />
                },
                {
                  name: 'Instagram',
                  icon: <PluginIcon pluginId="instagram" className="w-8 h-8" alt="Instagram" />
                },
                {
                  name: 'Google Ads',
                  icon: <PluginIcon pluginId="google-ads" className="w-8 h-8" alt="Google Ads" />
                },
                {
                  name: 'Meta Ads',
                  icon: <PluginIcon pluginId="meta-ads" className="w-8 h-8" alt="Meta Ads" />
                },
                {
                  name: 'Salesforce',
                  icon: <SiSalesforce className="w-8 h-8 text-[#00A1E0]" />
                },
                {
                  name: 'Stripe',
                  icon: <SiStripe className="w-8 h-8 text-[#635BFF]" />
                }
              ].map((integration, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                >
                  <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 backdrop-blur-xl rounded-xl p-4 border border-white/10 transition-all duration-300 text-center shadow-lg">
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
              <p className="text-gray-200">And 500+ more integrations available</p>
            </motion.div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-8 md:py-12 relative">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-xl rounded-3xl p-8 md:p-12 border border-white/20 shadow-2xl">
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                  Ready to Experience These Features?
                </h2>
                <p className="text-base md:text-lg text-gray-200 mb-6 max-w-2xl mx-auto">
                  Start with our free trial and discover how AI automation can transform your workflows.
                </p>

                <div className="flex justify-center">
                  <button className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:scale-105 transition-transform shadow-lg hover:shadow-orange-500/50">
                    Start Free Trial
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  )
}