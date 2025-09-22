'use client'

import { useState, useEffect } from 'react'

interface Feature {
  id: string
  title: string
  description: string
  icon: string
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
      icon: '💬',
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
      icon: '🔄',
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
      icon: '🔗',
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
      icon: '📊',
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
      icon: '🔒',
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
      icon: '⚡',
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
      icon: '🎨',
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
      icon: '🧠',
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
      icon: '👥',
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
      icon: '🔧',
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
      icon: '📈',
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
      icon: '📋',
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
    <div className="min-h-screen text-white relative overflow-hidden">
      <div className="relative z-10 bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 overflow-hidden min-h-screen">
        {/* Background Effects - Matching home page */}
        <div className="absolute inset-0 z-0">
          {/* Animated mesh gradient */}
          <div className="absolute inset-0 opacity-40">
            <div 
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.3) 0%, transparent 50%),
                  radial-gradient(circle at 80% 20%, rgba(147, 51, 234, 0.3) 0%, transparent 50%),
                  radial-gradient(circle at 40% 40%, rgba(99, 102, 241, 0.2) 0%, transparent 50%)
                `,
                animation: 'float 20s ease-in-out infinite'
              }}
            />
          </div>

          {/* Dynamic grid */}
          <div 
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `
                linear-gradient(rgba(139, 92, 246, 0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(139, 92, 246, 0.3) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
              animation: 'gridShift 25s linear infinite'
            }}
          />

          {/* Floating orbs */}
          <div className="absolute inset-0 hidden lg:block">
            <div
              className="absolute rounded-full bg-gradient-to-br from-blue-400/30 to-purple-400/30 blur-xl"
              style={{
                width: '60px',
                height: '60px',
                left: '10%',
                top: '20%',
                animation: 'float 8s ease-in-out infinite'
              }}
            />
            <div
              className="absolute rounded-full bg-gradient-to-br from-cyan-400/20 to-blue-400/20 blur-xl"
              style={{
                width: '80px',
                height: '80px',
                left: '80%',
                top: '60%',
                animation: 'float 10s ease-in-out infinite',
                animationDelay: '2s'
              }}
            />
          </div>
        </div>

        {/* Interactive mouse glow */}
        <div 
          className="absolute inset-0 z-0 pointer-events-none transition-all duration-500 hidden lg:block"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(139, 92, 246, 0.15), transparent 60%)`
          }}
        />

        <div className="relative z-10">
          {/* Header Section */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className={`transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                <div className="text-center mb-16">
                  <div className="inline-flex items-center px-6 py-3 rounded-full bg-cyan-500/20 border border-cyan-400/40 backdrop-blur-sm mb-8">
                    <span className="text-sm font-medium text-cyan-100">Enterprise-Grade • Professional Tools</span>
                  </div>

                  <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                    <span className="block text-white mb-2">Powerful AI</span>
                    <span className="block bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                      Features
                    </span>
                  </h1>

                  <p className="text-xl md:text-2xl text-gray-100 mb-12 max-w-4xl mx-auto leading-relaxed">
                    Everything you need to build, deploy, and scale intelligent automation across your organization.
                  </p>

                  {/* Category Filter */}
                  <div className="flex flex-wrap justify-center gap-3">
                    {categories.map(category => (
                      <button
                        key={category}
                        onClick={() => setActiveCategory(category)}
                        className={`px-6 py-3 rounded-full font-medium transition-all duration-300 ${
                          activeCategory === category
                            ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg'
                            : 'bg-purple-900/40 text-gray-200 border border-purple-500/30 hover:bg-purple-800/50'
                        }`}
                      >
                        {category === 'all' ? 'All Features' : category}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Core AI Features Highlight */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                    AI-Powered Core
                  </span>
                </h2>
                <p className="text-xl text-gray-200">The intelligent foundation that makes everything possible</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {coreFeatures.map((feature, index) => (
                  <div key={feature.id} className="bg-purple-900/40 backdrop-blur-sm rounded-2xl p-8 border border-purple-500/30 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-purple-500/25">
                    <div className="flex items-start space-x-4">
                      <div className="text-4xl">{feature.icon}</div>
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
                ))}
              </div>
            </div>
          </section>

          {/* Interactive Feature Demo */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  See It In Action
                </h2>
                <p className="text-xl text-gray-200">Interactive demonstration of key platform capabilities</p>
              </div>

              <div className="bg-black/50 backdrop-blur-xl border border-purple-500/30 rounded-3xl p-8 shadow-2xl">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <h3 className="text-2xl font-bold text-white">Natural Language to Automation</h3>
                    
                    <div className="bg-purple-900/50 rounded-xl p-6 border border-purple-500/30">
                      <div className="text-sm text-gray-300 mb-2">Input:</div>
                      <div className="bg-purple-800/30 rounded-lg p-4 border border-purple-400/30 mb-4">
                        <p className="text-gray-200 italic">
                          "Send me a Slack notification whenever a high-value lead completes our pricing calculator, 
                          and automatically add them to our VIP nurture sequence in HubSpot."
                        </p>
                      </div>
                      
                      <div className="text-sm text-gray-300 mb-2">AI Analysis:</div>
                      <div className="space-y-2">
                        <div className="flex items-center text-sm">
                          <div className="w-2 h-2 bg-blue-400 rounded-full mr-3"></div>
                          <span className="text-gray-200">Trigger: Pricing calculator completion</span>
                        </div>
                        <div className="flex items-center text-sm">
                          <div className="w-2 h-2 bg-purple-400 rounded-full mr-3"></div>
                          <span className="text-gray-200">Condition: High-value lead classification</span>
                        </div>
                        <div className="flex items-center text-sm">
                          <div className="w-2 h-2 bg-green-400 rounded-full mr-3"></div>
                          <span className="text-gray-200">Actions: Slack notification + HubSpot automation</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-2xl font-bold text-white">Generated Workflow</h3>
                    
                    <div className="bg-gradient-to-br from-blue-900/50 to-purple-900/50 rounded-xl p-6 border border-blue-400/30">
                      <div className="space-y-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">1</div>
                          <div>
                            <div className="font-medium text-white">Monitor Pricing Calculator</div>
                            <div className="text-sm text-gray-300">Webhook listener active</div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white text-sm font-bold">2</div>
                          <div>
                            <div className="font-medium text-white">Evaluate Lead Score</div>
                            <div className="text-sm text-gray-300">AI classification: High-value criteria</div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm font-bold">3</div>
                          <div>
                            <div className="font-medium text-white">Execute Actions</div>
                            <div className="text-sm text-gray-300">Slack + HubSpot integration</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-6 p-3 bg-green-900/30 rounded-lg border border-green-500/30">
                        <div className="text-sm text-green-300 font-medium">✓ Workflow deployed and active</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* All Features Grid */}
          <section className="py-20 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  Complete Feature Set
                </h2>
                <p className="text-xl text-gray-200">
                  {filteredFeatures.length} {filteredFeatures.length === 1 ? 'feature' : 'features'}
                  {activeCategory !== 'all' && ` in ${activeCategory}`}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredFeatures.map((feature) => (
                  <div
                    key={feature.id}
                    className={`bg-purple-900/40 backdrop-blur-sm rounded-xl p-6 border hover:scale-105 transition-all duration-300 cursor-pointer shadow-lg ${
                      selectedFeature === feature.id 
                        ? 'border-blue-400 shadow-blue-500/25' 
                        : 'border-purple-500/30 hover:shadow-purple-500/25'
                    }`}
                    onClick={() => setSelectedFeature(selectedFeature === feature.id ? null : feature.id)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="text-3xl mr-3">{feature.icon}</div>
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

                    {selectedFeature === feature.id && (
                      <div className="space-y-2 border-t border-purple-500/30 pt-4">
                        <div className="text-sm font-medium text-white mb-2">Key Benefits:</div>
                        {feature.benefits.map((benefit, index) => (
                          <div key={index} className="flex items-start text-sm">
                            <div className="w-2 h-2 bg-green-400 rounded-full mr-3 mt-1.5 flex-shrink-0"></div>
                            <span className="text-gray-300">{benefit}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 text-blue-300 text-sm font-medium">
                      {selectedFeature === feature.id ? 'Click to collapse' : 'Click for details'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Integration Showcase */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                    Enterprise Integrations
                  </span>
                </h2>
                <p className="text-xl text-gray-200">Connect with the tools your team already uses</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 mb-12">
                {[
                  { name: 'Slack', icon: '💬' },
                  { name: 'HubSpot', icon: '🎯' },
                  { name: 'Salesforce', icon: '☁️' },
                  { name: 'Microsoft 365', icon: '📧' },
                  { name: 'Google Workspace', icon: '📊' },
                  { name: 'Zoom', icon: '📹' },
                  { name: 'Notion', icon: '📝' },
                  { name: 'Zapier', icon: '⚡' },
                  { name: 'AWS', icon: '🌐' },
                  { name: 'Azure', icon: '☁️' },
                  { name: 'Stripe', icon: '💳' },
                  { name: 'QuickBooks', icon: '📈' }
                ].map((integration, index) => (
                  <div key={index} className="bg-purple-900/40 backdrop-blur-sm rounded-xl p-4 border border-purple-500/30 hover:scale-105 transition-all duration-300 text-center shadow-lg hover:shadow-purple-500/25">
                    <div className="text-2xl mb-2">{integration.icon}</div>
                    <div className="text-sm font-medium text-white">{integration.name}</div>
                  </div>
                ))}
              </div>

              <div className="text-center">
                <p className="text-gray-200 mb-6">And 500+ more integrations available</p>
                <button className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg">
                  View All Integrations
                </button>
              </div>
            </div>
          </section>

          {/* CTA Section */}
          <section className="py-20 relative">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="bg-black/50 backdrop-blur-xl rounded-3xl p-12 border border-purple-500/30 shadow-2xl">
                <h2 className="text-4xl font-bold text-white mb-4">
                  Ready to Experience These Features?
                </h2>
                <p className="text-xl text-gray-200 mb-8 max-w-2xl mx-auto">
                  Start with our free trial and discover how AI automation can transform your workflows.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg">
                    Start Free Trial
                  </button>
                  <button className="border-2 border-purple-400/50 text-purple-200 hover:bg-purple-800/30 px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform backdrop-blur-sm">
                    Schedule Demo
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <style jsx>{`
          @keyframes float {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            33% { transform: translate(30px, -30px) rotate(120deg); }
            66% { transform: translate(-20px, 20px) rotate(240deg); }
          }
          @keyframes gridShift {
            0% { background-position: 0 0; }
            100% { background-position: 40px 40px; }
          }
        `}</style>
      </div>
    </div>
  )
}