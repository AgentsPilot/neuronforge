'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Feature {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  category: string
  benefits: string[]
  technical: boolean
}

// SVG Icon Components
const MessageIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" className="fill-blue-400"/>
  </svg>
)

const WorkflowIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" className="fill-purple-400"/>
    <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" className="fill-purple-300"/>
  </svg>
)

const IntegrationIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"/>
  </svg>
)

const MonitorIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" className="fill-cyan-400"/>
  </svg>
)

const SecurityIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" className="fill-red-400"/>
  </svg>
)

const ScalingIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" className="fill-yellow-400"/>
  </svg>
)

const VisualIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" className="fill-pink-400"/>
  </svg>
)

const BrainIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M12 3C8.5 3 6 5.5 6 8.5c0 1.5-.7 2.8-1.8 3.5C3.5 12.5 3 13.7 3 15c0 2.8 2.2 5 5 5h8c2.8 0 5-2.2 5-5 0-1.3-.5-2.5-1.2-3-.5-.3-1.1-.7-1.4-1.2-.6-.9-1.4-1.8-1.4-2.8 0-3-2.5-5.5-6-5.5z" className="fill-purple-500"/>
    <circle cx="9" cy="12" r="1.5" className="fill-white"/>
    <circle cx="15" cy="12" r="1.5" className="fill-white"/>
    <path d="M10 16h4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const TeamIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" className="fill-green-400"/>
  </svg>
)

const APIIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"/>
  </svg>
)

const AnalyticsIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"/>
    <path d="M18 17l-5-5-3 3-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"/>
  </svg>
)

const ComplianceIcon = () => (
  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
    <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" className="fill-orange-400"/>
  </svg>
)

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
      icon: <MessageIcon />,
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
      icon: <WorkflowIcon />,
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
      icon: <IntegrationIcon />,
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
      icon: <MonitorIcon />,
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
      icon: <SecurityIcon />,
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
      icon: <ScalingIcon />,
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
      icon: <VisualIcon />,
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
      icon: <BrainIcon />,
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
      icon: <TeamIcon />,
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
      icon: <APIIcon />,
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
      icon: <AnalyticsIcon />,
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
      icon: <ComplianceIcon />,
      category: 'Security',
      benefits: [
        'GDPR, HIPAA, SOX compliance tools',
        'Automated compliance reporting',
        'Data retention policies',
        'Audit trail generation'
      ],
      technical: true
    }
  ]

  const categories = ['all', 'AI Core', 'Integrations', 'Operations', 'Security', 'Infrastructure', 'User Experience']

  const filteredFeatures = features.filter(feature => 
    activeCategory === 'all' || feature.category === activeCategory
  )

  const coreFeatures = features.filter(f => f.category === 'AI Core')
  const integrationFeatures = features.filter(f => f.category === 'Integrations')

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

      {/* Interactive mouse glow */}
      <div 
        className="fixed inset-0 pointer-events-none transition-all duration-500 hidden lg:block z-0"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(139, 92, 246, 0.15), transparent 60%)`
        }}
      />

      <div className="relative z-10">
        {/* Hero Section - Same style as main page */}
        <section className="relative pt-20 pb-32">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center mb-16"
            >
              <motion.h1 
                className="text-5xl md:text-7xl font-black mb-6 leading-tight"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
              >
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Powerful AI Features
                </span>
                <br />
                <span className="text-white">Built for Everyone</span>
              </motion.h1>
              
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-xl md:text-2xl text-slate-300 max-w-4xl mx-auto mb-8 leading-relaxed"
              >
                Everything you need to build, deploy, and scale intelligent automation across your organization.
                <br />
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
                    className={`px-6 py-3 rounded-full font-medium transition-all duration-300 ${
                      activeCategory === category
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-purple-500/25'
                        : 'bg-slate-900/50 text-gray-200 border border-white/10 hover:bg-slate-800/50 backdrop-blur-sm'
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
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-bold text-white mb-4">
                <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                  AI-Powered Core
                </span>
              </h2>
              <p className="text-xl text-gray-200">The intelligent foundation that makes everything possible</p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {coreFeatures.map((feature, index) => (
                <motion.div 
                  key={feature.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.2 }}
                  className="relative group"
                >
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500" />
                  <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-purple-500/25">
                    <div className="flex items-start space-x-4">
                      <div className="flex-shrink-0">{feature.icon}</div>
                      <div className="flex-1">
                        <h3 className="text-2xl font-bold text-white mb-3">{feature.title}</h3>
                        <p className="text-gray-200 mb-6 leading-relaxed">{feature.description}</p>
                        
                        <div className="space-y-2">
                          {feature.benefits.slice(0, 2).map((benefit, idx) => (
                            <div key={idx} className="flex items-center text-sm">
                              <div className="w-2 h-2 bg-green-400 rounded-full mr-3"></div>
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
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-bold text-white mb-4">
                See It In Action
              </h2>
              <p className="text-xl text-gray-200">Interactive demonstration of key platform capabilities</p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative group"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000" />
              <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl overflow-hidden">
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
                      className={`absolute w-2 h-2 rounded-full ${
                        i % 3 === 0 ? 'bg-blue-400' : i % 3 === 1 ? 'bg-purple-400' : 'bg-pink-400'
                      } blur-sm`}
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
                      className="bg-purple-900/50 rounded-xl p-6 border border-purple-500/30 relative overflow-hidden"
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
                        className="absolute inset-0 bg-gradient-to-r from-purple-500/20 via-blue-500/20 to-purple-500/20 rounded-xl"
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
                        
                        <div className="bg-purple-800/30 rounded-lg p-4 border border-purple-400/30 mb-4 relative">
                          {/* Typing animation */}
                          <motion.div
                            initial={{ width: 0 }}
                            whileInView={{ width: "100%" }}
                            viewport={{ once: true }}
                            transition={{ duration: 2, delay: 0.8 }}
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-transparent via-blue-400/10 to-transparent"
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
                            className="inline-block w-0.5 h-4 bg-blue-400 ml-1"
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
                            { text: "Trigger: Pricing calculator completion", color: "bg-blue-400", delay: 1.8 },
                            { text: "Condition: High-value lead classification", color: "bg-purple-400", delay: 2.0 },
                            { text: "Actions: Slack notification + HubSpot automation", color: "bg-green-400", delay: 2.2 }
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
                      className="bg-gradient-to-br from-blue-900/50 to-purple-900/50 rounded-xl p-6 border border-blue-400/30 relative overflow-hidden"
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
                              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.6" />
                              <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.8" />
                              <stop offset="100%" stopColor="#10B981" stopOpacity="0.6" />
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
                            color: "bg-blue-500",
                            delay: 2.6
                          },
                          { 
                            step: "2", 
                            title: "Evaluate Lead Score", 
                            subtitle: "AI classification: High-value criteria",
                            color: "bg-purple-500",
                            delay: 2.8
                          },
                          { 
                            step: "3", 
                            title: "Execute Actions", 
                            subtitle: "Slack + HubSpot integration",
                            color: "bg-green-500",
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
                        <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                          <motion.div
                            initial={{ width: "0%" }}
                            whileInView={{ width: "100%" }}
                            viewport={{ once: true }}
                            transition={{ duration: 1.5, delay: 3.4, ease: "easeInOut" }}
                            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 relative"
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
                          className="text-sm text-green-300 font-medium relative z-10"
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
                      className="absolute w-4 h-4 bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"
                    />
                  ))}
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* All Features Grid */}
        <section className="py-20 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-bold text-white mb-4">
                Complete Feature Set
              </h2>
              <p className="text-xl text-gray-200">
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
                  <div className={`absolute -inset-0.5 rounded-xl blur-lg transition duration-500 ${
                    selectedFeature === feature.id 
                      ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-75' 
                      : 'bg-gradient-to-r from-purple-500/50 to-blue-500/50 opacity-0 group-hover:opacity-50'
                  }`} />
                  
                  <div className={`relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-xl p-6 border transition-all duration-300 shadow-lg ${
                    selectedFeature === feature.id 
                      ? 'border-blue-400/50 shadow-blue-500/25 scale-105' 
                      : 'border-white/10 hover:border-purple-500/30 hover:scale-105 hover:shadow-purple-500/25'
                  }`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="mr-3">{feature.icon}</div>
                        <div>
                          <h3 className="text-lg font-bold text-white">{feature.title}</h3>
                          <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full border border-blue-400/30">
                            {feature.category}
                          </span>
                        </div>
                      </div>
                      {feature.technical && (
                        <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded-full border border-purple-400/30">
                          Technical
                        </span>
                      )}
                    </div>

                    <p className="text-gray-200 mb-4 text-sm leading-relaxed">
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

                    <div className="mt-4 text-blue-300 text-sm font-medium">
                      {selectedFeature === feature.id ? 'Click to collapse' : 'Click for details'}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Integration Showcase */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-bold text-white mb-4">
                <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                  Enterprise Integrations
                </span>
              </h2>
              <p className="text-xl text-gray-200">Connect with the tools your team already uses</p>
            </motion.div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 mb-12">
              {[
                { 
                  name: 'Slack', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 54 54" fill="none">
                      <path d="M19.715 34.542a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h4.5v4.5z" className="fill-green-400"/>
                      <path d="M21.965 34.542a4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v11.25a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5V34.542z" className="fill-green-400"/>
                      <path d="M26.465 19.5a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v4.5h-4.5z" className="fill-blue-400"/>
                      <path d="M26.465 21.75a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H15.215a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h11.25z" className="fill-blue-400"/>
                      <path d="M41.535 26.25a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5v-4.5h4.5z" className="fill-yellow-400"/>
                      <path d="M39.285 26.25a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v11.25a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5V26.25z" className="fill-yellow-400"/>
                      <path d="M34.785 41.5a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5v-4.5h4.5z" className="fill-pink-400"/>
                      <path d="M34.785 39.25a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h11.25a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H34.785z" className="fill-pink-400"/>
                    </svg>
                  )
                },
                { 
                  name: 'Gmail', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-.904.732-1.636 1.636-1.636a1.636 1.636 0 0 1 .909.273L12 9.375l9.455-5.281a1.636 1.636 0 0 1 .909-.273C23.268 3.821 24 4.553 24 5.457z" className="fill-red-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'Notion', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M4.459 4.208c.746.606 1.026.56 2.428.465l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.934zm14.337-.653c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933l3.269-.186z" className="fill-slate-300"/>
                    </svg>
                  )
                },
                { 
                  name: 'Google Drive', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M8.203 5.3L4.09 12.837h8.226L16.428 5.3H8.203z" className="fill-yellow-500"/>
                      <path d="M15.3 6.428l-4.113 7.538L15.3 21.504l8.226-7.538L15.3 6.428z" className="fill-blue-500"/>
                      <path d="M8.203 18.201L0 18.201l4.113-7.538 8.204 7.538z" className="fill-green-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'Google Calendar', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" className="fill-blue-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'HubSpot', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M18.164 7.93V5.084a1.71 1.71 0 1 0-1.113 0v2.846L15.133 9.6l-.063.051c-.604.495-1.386.767-2.201.767-.815 0-1.597-.272-2.201-.767L8.746 7.93V5.084a1.71 1.71 0 1 0-1.113 0V7.93L5.715 9.6l-.063.051c-.604.495-1.386.767-2.201.767-.815 0-1.597-.272-2.201-.767L0 8.336v8.58c0 .632.512 1.144 1.144 1.144h2.287c.632 0 1.144-.512 1.144-1.144V11.82l1.92 1.534c.604.495 1.386.767 2.201.767.815 0 1.597-.272 2.201-.767l1.92-1.534v5.096c0 .632.512 1.144 1.144 1.144h2.287c.632 0 1.144-.512 1.144-1.144V8.336l-1.25 1.315c-.604.495-1.386.767-2.201.767-.815 0-1.597-.272-2.201-.767l-1.92-1.534V11.82l1.92 1.534c.604.495 1.386.767 2.201.767.815 0 1.597-.272 2.201-.767z" className="fill-orange-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'Salesforce', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M12.5 2.5a5.5 5.5 0 015.379 6.543A3.5 3.5 0 0118.5 15.5h-13a2.5 2.5 0 01-.049-4.993A4.5 4.5 0 0112.5 2.5z" stroke="currentColor" strokeWidth="2" fill="none" className="text-blue-500"/>
                      <circle cx="12" cy="12" r="2" className="fill-blue-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'Microsoft 365', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M2 2v20h20V2H2zm18 18H4V4h16v16z" className="fill-blue-600"/>
                      <path d="M6 6h12v12H6V6zm2 2v8h8V8H8z" className="fill-orange-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'Zoom', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" className="fill-blue-500"/>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" className="text-blue-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'Zapier', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2l3.09 6.26L22 9l-5.91 4.74L18.18 22 12 18.77 5.82 22l2.09-8.26L2 9l6.91-.74L12 2z" className="fill-orange-500"/>
                    </svg>
                  )
                },
                { 
                  name: 'AWS', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M6.8 9.7c0 .7.1 1.2.3 1.6.2.4.5.6 1 .6.4 0 .8-.2 1.1-.5.3-.3.5-.8.5-1.4 0-.6-.2-1.1-.5-1.4-.3-.3-.7-.5-1.1-.5-.5 0-.8.2-1 .6-.2.4-.3.9-.3 1zm6.3-1.8c-.3-.3-.7-.5-1.1-.5-.5 0-.8.2-1 .6-.2.4-.3.9-.3 1.6 0 .7.1 1.2.3 1.6.2.4.5.6 1 .6.4 0 .8-.2 1.1-.5V7.9z" className="fill-orange-400"/>
                      <path d="M18.9 17.2c-1.1.8-2.7 1.2-4.1 1.2-1.9 0-3.7-.7-5-2-1.3-1.3-2-3.1-2-5s.7-3.7 2-5c1.3-1.3 3.1-2 5-2 1.4 0 3 .4 4.1 1.2.2.2.2.5 0 .7l-.7.7c-.2.2-.5.2-.7 0-.8-.6-1.8-.9-2.7-.9-1.3 0-2.5.5-3.4 1.4-.9.9-1.4 2.1-1.4 3.4s.5 2.5 1.4 3.4c.9.9 2.1 1.4 3.4 1.4.9 0 1.9-.3 2.7-.9.2-.2.5-.2.7 0l.7.7c.2.2.2.5 0 .7z" className="fill-orange-400"/>
                    </svg>
                  )
                },
                { 
                  name: 'Stripe', 
                  icon: (
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" className="fill-purple-500"/>
                    </svg>
                  )
                }
              ].map((integration, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="relative group"
                >
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500/50 to-blue-500/50 rounded-xl opacity-0 group-hover:opacity-75 blur-lg transition duration-500" />
                  <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-xl p-4 border border-white/10 hover:scale-105 transition-all duration-300 text-center shadow-lg hover:shadow-purple-500/25">
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
              <p className="text-gray-200 mb-6">And 500+ more integrations available</p>
              <button className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg hover:shadow-cyan-500/25">
                View All Integrations
              </button>
            </motion.div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 relative">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative group"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-75 blur-2xl group-hover:opacity-100 transition duration-1000" />
              <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-xl rounded-3xl p-12 border border-white/20 shadow-2xl">
                <h2 className="text-4xl font-bold text-white mb-4">
                  Ready to Experience These Features?
                </h2>
                <p className="text-xl text-gray-200 mb-8 max-w-2xl mx-auto">
                  Start with our free trial and discover how AI automation can transform your workflows.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg hover:shadow-cyan-500/25">
                    Start Free Trial
                  </button>
                  <button className="border-2 border-purple-400/50 text-purple-200 hover:bg-purple-800/30 px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform backdrop-blur-sm">
                    Schedule Demo
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