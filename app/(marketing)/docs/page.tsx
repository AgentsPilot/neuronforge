'use client'

import { useState, useEffect } from 'react'

interface Template {
  id: string
  name: string
  category: string
  description: string
  complexity: 'Beginner' | 'Intermediate' | 'Advanced'
  estimatedTime: string
  example: string
  useCase: string
  icon: string
}

interface UseCase {
  id: string
  title: string
  industry: string
  description: string
  benefits: string[]
  example: string
  icon: string
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('overview')
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const templates: Template[] = [
    {
      id: 'executive-inbox',
      name: 'Executive Inbox Monitor',
      category: 'Communication',
      description: 'Monitor VIP communications and provide intelligent alerts for executive-level priorities',
      complexity: 'Intermediate',
      estimatedTime: '5-8 minutes',
      example: '"Alert me when C-level executives or key clients send urgent emails"',
      useCase: 'Perfect for executives who need to stay on top of critical communications without constant email checking',
      icon: '📧'
    },
    {
      id: 'market-intelligence',
      name: 'Market Intelligence Agent',
      category: 'Analytics',
      description: 'Automated market monitoring with intelligent analysis and trend detection',
      complexity: 'Advanced',
      estimatedTime: '10-15 minutes',
      example: '"Track competitor pricing, industry news, and market sentiment for my sector"',
      useCase: 'Essential for strategic planning and competitive intelligence gathering',
      icon: '📈'
    },
    {
      id: 'meeting-summarizer',
      name: 'Meeting Intelligence',
      category: 'Productivity',
      description: 'Automatically process meeting recordings and generate actionable summaries',
      complexity: 'Beginner',
      estimatedTime: '3-5 minutes',
      example: '"Summarize my meetings and extract action items with owners and deadlines"',
      useCase: 'Ideal for busy professionals who attend multiple meetings daily',
      icon: '🎯'
    },
    {
      id: 'compliance-monitor',
      name: 'Compliance Monitor',
      category: 'Legal',
      description: 'Track regulatory changes and ensure organizational compliance',
      complexity: 'Advanced',
      estimatedTime: '12-20 minutes',
      example: '"Monitor SEC filings and alert me to regulatory changes affecting our industry"',
      useCase: 'Critical for legal teams and compliance officers in regulated industries',
      icon: '⚖️'
    },
    {
      id: 'sales-pipeline',
      name: 'Sales Pipeline Intelligence',
      category: 'Sales',
      description: 'Intelligent lead scoring and pipeline management with predictive analytics',
      complexity: 'Intermediate',
      estimatedTime: '7-10 minutes',
      example: '"Score leads based on engagement and alert me to high-value opportunities"',
      useCase: 'Perfect for sales teams looking to optimize conversion rates',
      icon: '🔍'
    },
    {
      id: 'risk-assessment',
      name: 'Risk Assessment Agent',
      category: 'Finance',
      description: 'Real-time risk monitoring across multiple data sources and markets',
      complexity: 'Advanced',
      estimatedTime: '15-25 minutes',
      example: '"Monitor portfolio risk metrics and alert me to significant market movements"',
      useCase: 'Essential for investment managers and risk officers',
      icon: '🛡️'
    }
  ]

  const useCases: UseCase[] = [
    {
      id: 'executive-operations',
      title: 'Executive Operations',
      industry: 'Leadership',
      description: 'Streamline executive decision-making with intelligent information processing and priority management',
      benefits: [
        'Reduce information overload by 80%',
        'Faster decision-making with contextual insights',
        'Automated priority routing and escalation',
        'Executive dashboard with key metrics'
      ],
      example: 'CEO receives daily AI-generated briefings with critical business metrics, urgent communications, and strategic recommendations',
      icon: '👔'
    },
    {
      id: 'financial-services',
      title: 'Financial Services',
      industry: 'Finance',
      description: 'Advanced financial analysis, risk management, and regulatory compliance automation',
      benefits: [
        'Real-time risk assessment and monitoring',
        'Automated compliance reporting',
        'Market intelligence and trend analysis',
        'Client portfolio optimization'
      ],
      example: 'Investment firm uses AI agents to monitor portfolio risk, track regulatory changes, and generate client reports automatically',
      icon: '💰'
    },
    {
      id: 'legal-operations',
      title: 'Legal Operations',
      industry: 'Legal',
      description: 'Intelligent contract analysis, compliance monitoring, and legal research automation',
      benefits: [
        'Automated contract review and analysis',
        'Regulatory change monitoring',
        'Legal research and precedent finding',
        'Deadline tracking and case management'
      ],
      example: 'Law firm automates contract analysis, tracks regulatory changes, and manages case deadlines with AI-powered workflows',
      icon: '⚖️'
    },
    {
      id: 'healthcare-admin',
      title: 'Healthcare Administration',
      industry: 'Healthcare',
      description: 'Patient data analysis, compliance monitoring, and operational efficiency optimization',
      benefits: [
        'Automated patient data processing',
        'Compliance with healthcare regulations',
        'Operational efficiency improvements',
        'Quality metrics monitoring'
      ],
      example: 'Hospital system uses AI to monitor patient outcomes, ensure compliance, and optimize resource allocation',
      icon: '🏥'
    }
  ]

  const navigationItems = [
    { id: 'overview', label: 'Overview', icon: '📋' },
    { id: 'quickstart', label: 'Quick Start', icon: '⚡' },
    { id: 'templates', label: 'Templates', icon: '🔧' },
    { id: 'use-cases', label: 'Use Cases', icon: '💡' },
    { id: 'api', label: 'API Reference', icon: '🔗' },
    { id: 'security', label: 'Security', icon: '🔒' }
  ]

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return (
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-blue-200 shadow-lg">
              <h2 className="text-3xl font-bold text-gray-900 mb-6 flex items-center">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-700 rounded-lg flex items-center justify-center mr-3">
                  <span className="text-white text-sm font-bold">AI</span>
                </div>
                Platform Overview
              </h2>
              <p className="text-gray-600 text-lg mb-6">
                AgentPilot is an enterprise-grade AI automation platform that transforms natural language descriptions 
                into intelligent, autonomous agents. Built for professionals who demand reliability, security, and scale.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-green-200 shadow-lg">
                  <div className="text-2xl font-bold text-green-600 mb-2">99.9%</div>
                  <div className="text-gray-900 font-semibold">Uptime SLA</div>
                  <div className="text-gray-500 text-sm">Enterprise reliability</div>
                </div>
                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-blue-200 shadow-lg">
                  <div className="text-2xl font-bold text-blue-600 mb-2">&lt;10s</div>
                  <div className="text-gray-900 font-semibold">Deploy Time</div>
                  <div className="text-gray-500 text-sm">From idea to running agent</div>
                </div>
                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-purple-200 shadow-lg">
                  <div className="text-2xl font-bold text-purple-600 mb-2">SOC 2</div>
                  <div className="text-gray-900 font-semibold">Compliant</div>
                  <div className="text-gray-500 text-sm">Enterprise security</div>
                </div>
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-purple-200 shadow-lg">
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Core Capabilities</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center mt-1">
                      <span className="text-white text-xs">1</span>
                    </div>
                    <div>
                      <div className="text-gray-900 font-semibold">Natural Language Processing</div>
                      <div className="text-gray-600 text-sm">Advanced NLP understands complex business requirements</div>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center mt-1">
                      <span className="text-white text-xs">2</span>
                    </div>
                    <div>
                      <div className="text-gray-900 font-semibold">Intelligent Automation</div>
                      <div className="text-gray-600 text-sm">Self-configuring workflows with smart decision making</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-cyan-600 rounded-full flex items-center justify-center mt-1">
                      <span className="text-white text-xs">3</span>
                    </div>
                    <div>
                      <div className="text-gray-900 font-semibold">Enterprise Integration</div>
                      <div className="text-gray-600 text-sm">Seamless connection to existing business systems</div>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center mt-1">
                      <span className="text-white text-xs">4</span>
                    </div>
                    <div>
                      <div className="text-gray-900 font-semibold">Real-time Monitoring</div>
                      <div className="text-gray-600 text-sm">Continuous operation with intelligent alerting</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )

      case 'quickstart':
        return (
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-green-200 shadow-lg">
              <h2 className="text-3xl font-bold text-gray-900 mb-6 flex items-center">
                <span className="text-2xl mr-3">⚡</span>
                Quick Start Guide
              </h2>
              <p className="text-gray-600 text-lg mb-8">
                Get your first AI agent running in under 5 minutes with this step-by-step guide.
              </p>

              <div className="space-y-6">
                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-blue-200 shadow-lg">
                  <div className="flex items-center mb-4">
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center mr-3">
                      <span className="text-white text-sm font-bold">1</span>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Install AgentPilot</h3>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <div className="text-green-400">$ npm install -g agentpilot</div>
                    <div className="text-gray-400"># or</div>
                    <div className="text-green-400">$ curl -sSL https://get.agentpilot.ai | bash</div>
                  </div>
                </div>

                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-purple-200 shadow-lg">
                  <div className="flex items-center mb-4">
                    <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center mr-3">
                      <span className="text-white text-sm font-bold">2</span>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Initialize Your Workspace</h3>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <div className="text-green-400">$ agentpilot init my-workspace</div>
                    <div className="text-green-400">$ cd my-workspace</div>
                    <div className="text-green-400">$ agentpilot auth login</div>
                  </div>
                </div>

                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-cyan-200 shadow-lg">
                  <div className="flex items-center mb-4">
                    <div className="w-8 h-8 bg-cyan-600 rounded-full flex items-center justify-center mr-3">
                      <span className="text-white text-sm font-bold">3</span>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Create Your First Agent</h3>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm mb-4">
                    <div className="text-green-400">$ agentpilot create agent</div>
                    <div className="text-blue-400">? Describe what you want your agent to do:</div>
                    <div className="text-white">  "Monitor my email and alert me about urgent messages"</div>
                  </div>
                  <div className="text-gray-600 text-sm">
                    The AI will automatically configure connections, set up monitoring, and deploy your agent.
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-yellow-200 shadow-lg">
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
                <span className="text-xl mr-3">💡</span>
                Pro Tips
              </h3>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2"></div>
                  <div className="text-gray-600">Use specific, descriptive language when creating agents for better results</div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2"></div>
                  <div className="text-gray-600">Start with simple workflows and gradually add complexity</div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2"></div>
                  <div className="text-gray-600">Test your agent in development mode before deploying to production</div>
                </div>
              </div>
            </div>
          </div>
        )

      case 'templates':
        return (
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-blue-200 shadow-lg">
              <h2 className="text-3xl font-bold text-gray-900 mb-6 flex items-center">
                <span className="text-2xl mr-3">🔧</span>
                Professional Templates
              </h2>
              <p className="text-gray-600 text-lg mb-8">
                Pre-configured agent templates for common professional workflows. Click any template to view implementation details.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className={`bg-white/90 backdrop-blur-sm rounded-xl p-6 border cursor-pointer transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl ${
                      activeTemplate === template.id 
                        ? 'border-blue-400 bg-blue-50' 
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                    onClick={() => setActiveTemplate(activeTemplate === template.id ? null : template.id)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <span className="text-2xl mr-3">{template.icon}</span>
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">{template.name}</h3>
                          <div className="flex items-center space-x-2 mt-1">
                            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">{template.category}</span>
                            <span className={`text-xs px-2 py-1 rounded ${
                              template.complexity === 'Beginner' ? 'bg-green-100 text-green-700' :
                              template.complexity === 'Intermediate' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {template.complexity}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-gray-500 text-sm">{template.estimatedTime}</div>
                    </div>
                    
                    <p className="text-gray-600 mb-4">{template.description}</p>
                    
                    {activeTemplate === template.id && (
                      <div className="space-y-4 border-t border-gray-200 pt-4">
                        <div>
                          <h4 className="text-gray-900 font-semibold mb-2">Example Command:</h4>
                          <div className="bg-gray-900 rounded-lg p-3 font-mono text-sm text-green-400">
                            {template.example}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-gray-900 font-semibold mb-2">Use Case:</h4>
                          <p className="text-gray-600 text-sm">{template.useCase}</p>
                        </div>
                        <button className="w-full bg-gradient-to-r from-blue-600 to-purple-700 text-white py-2 rounded-lg hover:scale-105 transition-transform shadow-lg">
                          Deploy This Template
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      case 'use-cases':
        return (
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-purple-200 shadow-lg">
              <h2 className="text-3xl font-bold text-gray-900 mb-6 flex items-center">
                <span className="text-2xl mr-3">💡</span>
                Professional Use Cases
              </h2>
              <p className="text-gray-600 text-lg mb-8">
                Real-world applications of AI automation across different industries and business functions.
              </p>

              <div className="space-y-6">
                {useCases.map((useCase) => (
                  <div key={useCase.id} className="bg-white/90 backdrop-blur-sm rounded-xl p-8 border border-gray-200 hover:border-purple-300 transition-all duration-300 shadow-lg hover:shadow-xl">
                    <div className="flex items-start space-x-4">
                      <div className="text-4xl">{useCase.icon}</div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-2xl font-bold text-gray-900">{useCase.title}</h3>
                          <span className="text-sm px-3 py-1 bg-purple-100 text-purple-700 rounded">{useCase.industry}</span>
                        </div>
                        
                        <p className="text-gray-600 mb-6">{useCase.description}</p>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <h4 className="text-gray-900 font-semibold mb-3">Key Benefits:</h4>
                            <ul className="space-y-2">
                              {useCase.benefits.map((benefit, index) => (
                                <li key={index} className="flex items-center text-gray-600 text-sm">
                                  <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                                  {benefit}
                                </li>
                              ))}
                            </ul>
                          </div>
                          
                          <div>
                            <h4 className="text-gray-900 font-semibold mb-3">Real-World Example:</h4>
                            <div className="bg-gray-50 rounded-lg p-4 text-gray-600 text-sm italic border border-gray-200">
                              "{useCase.example}"
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      case 'api':
        return (
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-cyan-200 shadow-lg">
              <h2 className="text-3xl font-bold text-gray-900 mb-6 flex items-center">
                <span className="text-2xl mr-3">🔗</span>
                API Reference
              </h2>
              <p className="text-gray-600 text-lg mb-8">
                Comprehensive API documentation for developers who need programmatic access to AgentPilot.
              </p>

              <div className="space-y-6">
                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-blue-200 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Authentication</h3>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm mb-4">
                    <div className="text-gray-400">// API Key Authentication</div>
                    <div className="text-green-400">curl -H "Authorization: Bearer YOUR_API_KEY" \</div>
                    <div className="text-green-400">     -H "Content-Type: application/json" \</div>
                    <div className="text-green-400">     https://api.agentpilot.ai/v1/agents</div>
                  </div>
                </div>

                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-purple-200 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Create Agent</h3>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm mb-4">
                    <div className="text-blue-400">POST /v1/agents</div>
                    <div className="text-gray-400 mt-2">// Request Body</div>
                    <div className="text-white">{`{
  "name": "Executive Inbox Monitor",
  "description": "Monitor VIP emails and send alerts",
  "config": {
    "triggers": ["email_received"],
    "filters": {
      "priority": "high",
      "senders": ["ceo@company.com"]
    },
    "actions": ["send_notification"]
  }
}`}</div>
                  </div>
                </div>

                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-green-200 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Agent Status</h3>
                  <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <div className="text-blue-400">GET /v1/agents/status</div>
                    <div className="text-gray-400 mt-2">// Response</div>
                    <div className="text-white">{`{
  "id": "agent_123",
  "status": "active",
  "uptime": "99.9%",
  "last_activity": "2024-01-15T10:30:00Z",
  "metrics": {
    "triggers_processed": 1234,
    "actions_executed": 987
  }
}`}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )

      case 'security':
        return (
          <div className="space-y-8">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-red-200 shadow-lg">
              <h2 className="text-3xl font-bold text-gray-900 mb-6 flex items-center">
                <span className="text-2xl mr-3">🔒</span>
                Security & Compliance
              </h2>
              <p className="text-gray-600 text-lg mb-8">
                Enterprise-grade security measures and compliance certifications to protect your data and operations.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-green-200 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                    <span className="text-lg mr-2">🛡️</span>
                    Data Protection
                  </h3>
                  <ul className="space-y-3">
                    <li className="flex items-center text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      End-to-end encryption in transit and at rest
                    </li>
                    <li className="flex items-center text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      Zero-knowledge architecture
                    </li>
                    <li className="flex items-center text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      Data residency controls
                    </li>
                    <li className="flex items-center text-gray-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      Regular security audits
                    </li>
                  </ul>
                </div>

                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-blue-200 shadow-lg">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                    <span className="text-lg mr-2">📋</span>
                    Compliance Certifications
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <span className="text-gray-900 font-semibold">SOC 2 Type II</span>
                      <span className="text-green-600 text-sm font-medium">Certified</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <span className="text-gray-900 font-semibold">GDPR Compliant</span>
                      <span className="text-green-600 text-sm font-medium">Verified</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <span className="text-gray-900 font-semibold">HIPAA Ready</span>
                      <span className="text-blue-600 text-sm font-medium">Available</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-yellow-200 shadow-lg mt-6">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                  <span className="text-lg mr-2">🔐</span>
                  Access Controls
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600 mb-2">MFA</div>
                    <div className="text-gray-600 text-sm">Multi-factor authentication required</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600 mb-2">RBAC</div>
                    <div className="text-gray-600 text-sm">Role-based access controls</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600 mb-2">SSO</div>
                    <div className="text-gray-600 text-sm">Single sign-on integration</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 relative overflow-hidden">
      {/* Subtle AI Grid Background */}
      <div className="fixed inset-0 z-0">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59, 130, 246, 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59, 130, 246, 0.08) 1px, transparent 1px)
            `,
            backgroundSize: '30px 30px',
            animation: 'gridMove 25s linear infinite'
          }}
        />
      </div>

      {/* Subtle Interactive Mouse Glow */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none transition-all duration-300"
        style={{
          background: `radial-gradient(400px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(59, 130, 246, 0.03), transparent 40%)`
        }}
      />

      <div className="relative z-10 flex">
        {/* Sidebar Navigation */}
        <div className="w-80 min-h-screen bg-white/90 backdrop-blur-sm border-r border-gray-200 p-6 sticky top-0 shadow-lg">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-700 rounded-lg flex items-center justify-center mr-3">
                <span className="text-white text-sm font-bold">AP</span>
              </div>
              Documentation
            </h1>
            <p className="text-gray-500 text-sm">Enterprise AI Platform</p>
          </div>

          <nav className="space-y-2">
            {navigationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  activeSection === item.id
                    ? 'bg-blue-100 text-blue-700 border border-blue-200 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-8 p-4 bg-white/90 backdrop-blur-sm rounded-lg border border-green-200 shadow-lg">
            <div className="flex items-center mb-2">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
              <span className="text-green-700 text-sm font-semibold">System Status</span>
            </div>
            <div className="text-gray-600 text-xs">All systems operational</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-8 bg-gradient-to-br from-gray-50 to-white">
          <div className="max-w-4xl mx-auto">
            {renderSection()}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes gridMove {
          0% { background-position: 0 0; }
          100% { background-position: 30px 30px; }
        }
      `}</style>
    </div>
  )
}