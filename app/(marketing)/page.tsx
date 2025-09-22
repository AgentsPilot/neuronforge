'use client'

import { useState, useEffect } from 'react'

export default function ModernAILanding() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    setIsVisible(true)
    
    // Auto-cycle through demo steps
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % 3)
    }, 4000)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      clearInterval(interval)
    }
  }, [])

  const demoSteps = [
    {
      user: "Schedule my quarterly board meeting and send personalized invites to all directors with agenda prep.",
      ai: "✅ Meeting scheduled for next Thursday 2PM\n✅ Calendar invites sent to 8 board members\n✅ Personalized agenda packets prepared\n✅ Meeting room reserved with AV setup\n\n🎯 All directors confirmed attendance",
      status: "Completed in 12 seconds"
    },
    {
      user: "Monitor our competitor's product launches and alert me when they announce anything in our market segment.",
      ai: "🔍 Monitoring 23 competitor sources\n📊 AI scanning: news, social media, press releases\n🎯 Smart filters active for your market keywords\n📱 Instant alerts configured\n\n✨ Your competitive intelligence agent is live",
      status: "Monitoring activated"
    },
    {
      user: "Analyze our Q4 sales data and create executive summary with key insights for tomorrow's leadership meeting.",
      ai: "📈 Analyzing 4,847 transactions\n🔍 Identifying trends and patterns\n📊 Generating visual charts\n📝 Creating executive summary\n\n📋 Report ready: 23% growth, new opportunities in Enterprise segment identified",
      status: "Analysis complete"
    }
  ]

  return (
    <div className="relative text-white overflow-hidden">
      <div className="relative z-10 bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 overflow-hidden">
        {/* Background Effects - Contained within this section */}
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

        {/* Redesigned Banner Section */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-900 to-purple-900 text-white relative overflow-hidden">
          <div className="max-w-7xl mx-auto relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center py-16">
              
              {/* Left side - Content */}
              <div className="space-y-6 px-4">
                <div className="inline-flex items-center px-4 py-2 rounded-full bg-cyan-500/20 border border-cyan-400/40 backdrop-blur-sm">
                  <div className="w-2 h-2 bg-cyan-300 rounded-full mr-2 animate-pulse"></div>
                  <span className="text-sm font-medium text-cyan-100">AI Platform 3.0 • Enterprise Ready</span>
                </div>
                
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-black leading-tight">
                  <span className="block text-white mb-2">Your Personal</span>
                  <span className="block bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent mb-2">
                    AI Workforce
                  </span>
                  <span className="block text-white">Ready in Minutes</span>
                </h1>
                
                <p className="text-xl text-gray-100 leading-relaxed">
                  Deploy intelligent agents that automate complex workflows with zero coding required.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <button className="group bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 text-lg rounded-xl hover:shadow-xl transition-all duration-300 hover:scale-105 font-semibold">
                    <span className="flex items-center justify-center">
                      Start Building Free
                      <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </span>
                  </button>
                </div>
                
                {/* Trust indicators */}
                <div className="flex items-center space-x-6 text-sm text-gray-200 pt-4">
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-cyan-300" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    No credit card
                  </span>
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-cyan-300" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    60s setup
                  </span>
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-cyan-300" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Enterprise secure
                  </span>
                </div>
              </div>
              
              {/* Right side - Image Container */}
              <div className="relative px-4 flex justify-center items-center">
                <div className="relative">
                  {/* Decorative background elements */}
                  <div className="absolute -inset-4 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-2xl blur-xl"></div>
                  <div className="absolute -inset-2 bg-gradient-to-r from-cyan-500/30 to-blue-500/30 rounded-xl blur-lg"></div>
                  
                  {/* Image container with proper aspect ratio */}
                  <div className="relative bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                    <img 
                      src="/images/AgentsPilot%20Banner.png" 
                      alt="AgentPilot AI Agents Dashboard"
                      className="w-full h-auto max-w-lg rounded-lg shadow-2xl"
                      style={{
                        filter: 'drop-shadow(0 25px 25px rgba(0, 0, 0, 0.3))'
                      }}
                    />
                  </div>
                  
                  {/* Floating elements for visual interest */}
                  <div className="absolute -top-4 -right-4 w-8 h-8 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full animate-pulse"></div>
                  <div className="absolute -bottom-4 -left-4 w-6 h-6 bg-gradient-to-r from-purple-400 to-pink-500 rounded-full animate-bounce" style={{animationDelay: '1s'}}></div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Subtle background pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
              backgroundSize: '20px 20px'
            }}></div>
          </div>
        </div>

        {/* Hero Section with Metrics */}
        <section className="relative py-20 flex items-center justify-center">
          <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            

            {/* Live metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {[
                { value: "47,000+", label: "AI Agents Created", trend: "+12% this week" },
                { value: "2.3M", label: "Tasks Automated", trend: "Last 30 days" },
                { value: "8.4s", label: "Average Setup Time", trend: "Industry leading" }
              ].map((metric, index) => (
                <div key={index} className="bg-purple-900/40 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30 hover:scale-105 transition-all duration-300 group shadow-lg hover:shadow-purple-500/25">
                  <div className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-1">
                    {metric.value}
                  </div>
                  <div className="text-gray-300 font-medium mb-2">{metric.label}</div>
                  <div className="text-xs text-gray-500">{metric.trend}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Demo Section */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  See It In Action
                </span>
              </h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Watch how professionals create powerful AI agents with simple conversations
              </p>
            </div>

            {/* Interactive Demo */}
            <div className="relative bg-black/50 backdrop-blur-xl border border-purple-500/30 rounded-3xl p-8 shadow-2xl overflow-hidden">
              {/* Demo header */}
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-purple-500/30">
                <div className="flex items-center space-x-3">
                  <div className="flex space-x-2">
                    <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                    <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                  </div>
                  <span className="text-gray-200 font-semibold">AgentPilot Studio</span>
                </div>
                <div className="flex items-center space-x-2 text-sm text-gray-400">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span>Live Demo</span>
                </div>
              </div>

              {/* Step indicators */}
              <div className="flex justify-center mb-8">
                <div className="flex space-x-2">
                  {[0, 1, 2].map((step) => (
                    <button
                      key={step}
                      onClick={() => setCurrentStep(step)}
                      className={`w-3 h-3 rounded-full transition-all duration-300 ${
                        currentStep === step 
                          ? 'bg-purple-500 scale-125' 
                          : 'bg-gray-600 hover:bg-gray-500'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Demo conversation */}
              <div className="space-y-6 min-h-[400px]">
                {/* User message */}
                <div className="flex justify-end">
                  <div className="max-w-2xl bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl rounded-br-lg p-6 shadow-lg">
                    <p className="text-white text-lg font-medium">
                      {demoSteps[currentStep].user}
                    </p>
                    <div className="flex items-center text-blue-200 text-sm mt-3 opacity-90">
                      <div className="w-2 h-2 bg-blue-300 rounded-full mr-2"></div>
                      Professional User
                    </div>
                  </div>
                </div>

                {/* AI response with typing animation */}
                <div className="flex justify-start">
                  <div className="max-w-3xl bg-purple-900/50 border border-purple-500/30 rounded-2xl rounded-bl-lg p-6 shadow-lg backdrop-blur-sm">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <span className="text-gray-200 font-semibold">AI Agent</span>
                      <div className="flex space-x-1">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{animationDelay: `${i * 0.1}s`}} />
                        ))}
                      </div>
                    </div>
                    
                    <div className="text-gray-200 text-lg whitespace-pre-line mb-4">
                      {demoSteps[currentStep].ai}
                    </div>

                    <div className="bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-xl p-4 border border-green-500/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-3 h-3 bg-green-400 rounded-full mr-3 animate-pulse"></div>
                          <span className="text-green-300 font-semibold">{demoSteps[currentStep].status}</span>
                        </div>
                        <button className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg text-white text-sm font-medium hover:scale-105 transition-transform shadow-lg">
                          View Results
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Demo footer */}
              <div className="text-center mt-8 pt-6 border-t border-purple-500/30">
                <div className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-full border border-green-500/30 backdrop-blur-sm shadow-lg">
                  <svg className="w-5 h-5 mr-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-200 font-semibold">Enterprise AI Agent deployed in seconds</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section with Cards */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  Built for Every Professional
                </span>
              </h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Whether you're a CEO, consultant, or team lead - create AI agents that understand your unique workflow
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
              {[
                {
                  icon: (
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ),
                  title: "Executive Assistant",
                  description: "Manage calendar, prioritize emails, prepare briefings, track KPIs",
                  color: "from-blue-500 to-cyan-500",
                  bgColor: "from-blue-500/10 to-cyan-500/10",
                  borderColor: "border-blue-400/30",
                  features: ["Email prioritization", "Meeting scheduling", "Report generation"]
                },
                {
                  icon: (
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  ),
                  title: "Business Analyst",
                  description: "Monitor markets, analyze trends, generate insights, create reports",
                  color: "from-purple-500 to-pink-500",
                  bgColor: "from-purple-500/10 to-pink-500/10",
                  borderColor: "border-purple-400/30",
                  features: ["Market monitoring", "Data analysis", "Trend identification"]
                },
                {
                  icon: (
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  ),
                  title: "Sales Assistant",
                  description: "Lead qualification, follow-ups, pipeline management, customer insights",
                  color: "from-green-500 to-emerald-500",
                  bgColor: "from-green-500/10 to-emerald-500/10",
                  borderColor: "border-green-400/30",
                  features: ["Lead scoring", "Follow-up automation", "CRM integration"]
                },
                {
                  icon: (
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  ),
                  title: "Compliance Monitor",
                  description: "Track regulations, audit deadlines, risk assessment, documentation",
                  color: "from-orange-500 to-red-500",
                  bgColor: "from-orange-500/10 to-red-500/10",
                  borderColor: "border-orange-400/30",
                  features: ["Regulation tracking", "Risk alerts", "Audit preparation"]
                },
                {
                  icon: (
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  ),
                  title: "Research Agent",
                  description: "Market research, competitor analysis, industry reports, data gathering",
                  color: "from-indigo-500 to-purple-500",
                  bgColor: "from-indigo-500/10 to-purple-500/10",
                  borderColor: "border-indigo-400/30",
                  features: ["Competitor tracking", "Industry insights", "Research automation"]
                },
                {
                  icon: (
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  ),
                  title: "Operations Manager",
                  description: "Process optimization, resource allocation, performance tracking",
                  color: "from-teal-500 to-blue-500",
                  bgColor: "from-teal-500/10 to-blue-500/10",
                  borderColor: "border-teal-400/30",
                  features: ["Process automation", "Resource optimization", "Performance metrics"]
                }
              ].map((agent, index) => (
                <div key={index} className={`group bg-gradient-to-br ${agent.bgColor} backdrop-blur-sm rounded-2xl p-6 border ${agent.borderColor} hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-purple-500/25 overflow-hidden`}>
                  {/* Glassmorphism effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-2xl"></div>
                  
                  <div className="relative z-10">
                    {/* Icon and Title Section - Horizontal Layout */}
                    <div className="flex items-center mb-4">
                      <div className={`w-12 h-12 bg-gradient-to-r ${agent.color} rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform shadow-lg`}>
                        {agent.icon}
                      </div>
                      <h3 className="text-xl font-bold text-white">{agent.title}</h3>
                    </div>
                    
                    {/* Description */}
                    <p className="text-gray-300 mb-4">{agent.description}</p>
                    
                    {/* Features with compact styling */}
                    <div className="space-y-2">
                      {agent.features.map((feature, idx) => (
                        <div key={idx} className="flex items-center text-sm text-gray-400">
                          <svg className="w-4 h-4 mr-2 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {feature}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Hover glow effect */}
                  <div className={`absolute inset-0 bg-gradient-to-r ${agent.color} opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity duration-300 blur-lg`}></div>
                </div>
              ))}
            </div>

            {/* Quick start CTA */}
            <div className="text-center">
              <button className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-4 text-lg rounded-xl hover:shadow-xl transition-all duration-300 hover:scale-105 font-semibold">
                Choose Your AI Agent Template
              </button>
            </div>
          </div>
        </section>

        {/* How It Works - Simplified */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  From Idea to AI Agent
                </span>
              </h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Three simple steps to automate any business process
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              {/* Connection lines */}
              <div className="hidden md:block absolute top-16 left-1/3 w-1/3 h-0.5 bg-gradient-to-r from-blue-400 to-purple-400"></div>
              <div className="hidden md:block absolute top-16 right-1/3 w-1/3 h-0.5 bg-gradient-to-r from-purple-400 to-cyan-400"></div>

              {[
                {
                  step: "1",
                  title: "Describe Your Need",
                  description: "Tell us what you want to automate in plain English. No technical knowledge required.",
                  icon: (
                    <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  )
                },
                {
                  step: "2",
                  title: "AI Builds Your Agent",
                  description: "Our AI understands your requirements and automatically creates a custom agent for your specific workflow.",
                  icon: (
                    <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  )
                },
                {
                  step: "3",
                  title: "Deploy & Monitor",
                  description: "Your AI agent starts working immediately. Monitor performance and adjust as needed through our intuitive dashboard.",
                  icon: (
                    <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )
                }
              ].map((item, index) => (
                <div key={index} className="text-center relative">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 bg-purple-900/50 border-2 border-purple-500/30 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto shadow-lg hover:scale-110 transition-transform duration-300 backdrop-blur-sm">
                      {item.icon}
                    </div>
                    <div className="absolute -bottom-2 sm:-bottom-3 left-1/2 transform -translate-x-1/2">
                      <div className="px-3 sm:px-4 py-1 sm:py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-bold rounded-full shadow-lg">
                        {item.step}
                      </div>
                    </div>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">{item.title}</h3>
                  <p className="text-gray-300 text-base sm:text-lg">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Social Proof */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  Trusted by Professionals Worldwide
                </span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
              {[
                {
                  quote: "AgentPilot transformed how we handle client communications. Our AI agent processes 200+ emails daily and only escalates what truly needs our attention.",
                  author: "Sarah Chen",
                  role: "Managing Partner",
                  company: "Global Consulting Group",
                  avatar: "SC",
                  color: "from-blue-600 to-purple-600"
                },
                {
                  quote: "We automated our entire lead qualification process. The AI agent scores leads, schedules follow-ups, and even drafts personalized outreach messages.",
                  author: "Marcus Rodriguez",
                  role: "VP of Sales",
                  company: "TechScale Solutions",
                  avatar: "MR",
                  color: "from-purple-600 to-pink-600"
                },
                {
                  quote: "Our compliance monitoring agent tracks 15 different regulatory frameworks. It's like having a dedicated compliance officer working 24/7.",
                  author: "Dr. Emily Watson",
                  role: "Chief Compliance Officer",
                  company: "FinSecure Bank",
                  avatar: "EW",
                  color: "from-green-600 to-blue-600"
                }
              ].map((testimonial, index) => (
                <div key={index} className="bg-purple-900/30 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-purple-500/25">
                  <p className="text-gray-300 text-lg mb-6 italic">"{testimonial.quote}"</p>
                  <div className="flex items-center">
                    <div className={`w-12 h-12 bg-gradient-to-r ${testimonial.color} rounded-full flex items-center justify-center mr-4`}>
                      <span className="text-white font-bold">{testimonial.avatar}</span>
                    </div>
                    <div>
                      <div className="text-white font-semibold">{testimonial.author}</div>
                      <div className="text-gray-300 text-sm">{testimonial.role}</div>
                      <div className="text-blue-400 text-sm font-medium">{testimonial.company}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Company logos placeholder */}
            <div className="text-center">
              <p className="text-gray-400 mb-8">Trusted by teams at companies like:</p>
              <div className="flex justify-center items-center space-x-8 opacity-60">
                {['Microsoft', 'Google', 'Amazon', 'Salesforce', 'IBM'].map((company, index) => (
                  <div key={index} className="text-2xl font-bold text-gray-500">{company}</div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20 relative bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 text-white overflow-hidden">
          {/* Background effects */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute inset-0" style={{
              backgroundImage: `
                radial-gradient(circle at 25% 25%, rgba(139, 92, 246, 0.3) 0%, transparent 50%),
                radial-gradient(circle at 75% 75%, rgba(59, 130, 246, 0.3) 0%, transparent 50%)
              `
            }}></div>
          </div>

          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              Ready to Build Your AI Workforce?
            </h2>
            <p className="text-xl md:text-2xl mb-8 opacity-90">
              Join thousands of professionals who've automated their workflows with AI
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <button className="bg-white text-blue-600 px-8 py-4 text-lg rounded-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 font-semibold">
                Start Building Free
              </button>
              <button className="border-2 border-white/30 text-white hover:bg-white/10 px-8 py-4 text-lg rounded-xl transition-all duration-300 hover:scale-105 font-semibold backdrop-blur-sm">
                Schedule Demo
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm opacity-80">
              <div className="flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Setup in 60 seconds
              </div>
              <div className="flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                No coding required
              </div>
              <div className="flex items-center justify-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Enterprise security
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* Custom animations */}
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
  )
}