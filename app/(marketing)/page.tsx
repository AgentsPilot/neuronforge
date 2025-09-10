'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'

export default function HomePage() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    setIsVisible(true)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  return (
    <div className="relative min-h-screen bg-white text-gray-900 overflow-hidden">
      {/* Sophisticated Light Grid Background */}
      <div className="fixed inset-0 z-0">
        <div 
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59, 130, 246, 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59, 130, 246, 0.08) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
            animation: 'gridMove 20s linear infinite'
          }}
        />
      </div>

      {/* Elegant Floating Particles */}
      <div className="fixed inset-0 z-0">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-blue-500 rounded-full animate-pulse opacity-60"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 4}s`,
              animationDuration: `${3 + Math.random() * 2}s`
            }}
          />
        ))}
      </div>

      {/* Subtle Interactive Mouse Glow */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none transition-all duration-300"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(59, 130, 246, 0.04), transparent 50%)`
        }}
      />

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
          {/* Subtle Floating Elements */}
          <div className="absolute inset-0">
            <div className="absolute top-20 left-20 w-32 h-32 bg-blue-500/3 rounded-full blur-2xl animate-pulse" />
            <div className="absolute bottom-32 right-32 w-48 h-48 bg-purple-500/3 rounded-full blur-3xl animate-pulse" style={{animationDelay: '2s'}} />
            <div className="absolute top-1/2 left-1/3 w-24 h-24 bg-cyan-500/3 rounded-full blur-xl animate-pulse" style={{animationDelay: '4s'}} />
          </div>

          {/* Main Content */}
          <div className={`relative z-10 text-center px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            
            {/* Enhanced Headline */}
            <h1 className="text-6xl md:text-8xl font-black mb-8 leading-tight">
              <span className="block text-gray-900 mb-2">From Idea to</span>
              <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent mb-2">
                AI Agent
              </span>
              <span className="block text-gray-900">in Seconds</span>
            </h1>

            {/* Professional Subtitle */}
            <div className="text-xl md:text-2xl text-gray-600 mb-12 max-w-4xl mx-auto leading-relaxed">
              <p className="mb-4">The enterprise AI automation platform designed for professionals.</p>
              <p className="text-lg text-blue-700 font-medium">No code. No complexity. Just intelligent automation.</p>
            </div>

            {/* Enhanced CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-6 justify-center mb-16">
              <button className="group relative bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white px-10 py-5 text-lg rounded-2xl transition-all duration-300 hover:scale-105 shadow-2xl hover:shadow-blue-500/25 overflow-hidden">
                <span className="relative z-10 flex items-center justify-center font-semibold">
                  Free Trial
                  <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-700 to-purple-800 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              
            </div>

            {/* AI Performance Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              {[
                { value: "8.3s", label: "Average Build Time", icon: "⚡" },
                { value: "99.9%", label: "Uptime Reliability", icon: "🛡️" },
                { value: "0", label: "Lines of Code Required", icon: "🚀" }
              ].map((metric, index) => (
                <div key={index} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200 hover:scale-105 transition-all duration-300 group shadow-lg hover:shadow-xl">
                  <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    {metric.value}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{metric.label}</div>
                  <div className="text-xl opacity-50 group-hover:opacity-100 transition-opacity">{metric.icon}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Enhanced Scroll Indicator */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2">
            <div className="w-6 h-10 border-2 border-blue-500 rounded-full flex justify-center p-1">
              <div className="w-1 h-3 bg-blue-500 rounded-full animate-bounce" />
            </div>
          </div>
        </section>

        {/* AI Process Section */}
        <section className="py-32 relative overflow-hidden bg-gradient-to-b from-gray-50 to-white">
          
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-20">
              <div className="inline-flex items-center px-6 py-3 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 backdrop-blur-sm mb-8 shadow-lg">
                <svg className="w-5 h-5 mr-2 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-blue-700">Neural Processing • Enterprise Ready</span>
              </div>
              
              <h2 className="text-5xl md:text-7xl font-black text-gray-900 mb-8 leading-tight">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  AI Understands You
                </span>
              </h2>
              
              <p className="text-2xl text-gray-600 max-w-4xl mx-auto leading-relaxed mb-12">
                Professional-grade automation through natural conversation
              </p>
            </div>

            {/* Enhanced Demo Interface */}
            <div className="mb-24">
              <div className="max-w-6xl mx-auto">
                <div className="relative bg-white/90 backdrop-blur-2xl border border-gray-200 rounded-3xl p-8 shadow-2xl overflow-hidden">
                  {/* Elegant Header Line */}
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                  
                  {/* Terminal Header */}
                  <div className="flex items-center space-x-2 mb-6 pb-4 border-b border-gray-200">
                    <div className="flex space-x-2">
                      <div className="w-3 h-3 bg-red-400 rounded-full" />
                      <div className="w-3 h-3 bg-yellow-400 rounded-full" />
                      <div className="w-3 h-3 bg-green-400 rounded-full" />
                    </div>
                    <div className="flex-1 text-center">
                      <span className="text-blue-700 text-sm font-mono font-semibold">AgentPilot Neural Interface v2.0</span>
                    </div>
                    <div className="text-xs text-gray-500 bg-green-50 px-2 py-1 rounded">SECURE CONNECTION</div>
                  </div>

                  {/* Chat Interface */}
                  <div className="space-y-6">
                    {/* User Input */}
                    <div className="flex justify-end">
                      <div className="max-w-2xl bg-gradient-to-r from-blue-600 to-purple-700 rounded-2xl rounded-br-lg p-6 shadow-lg">
                        <p className="text-white text-lg font-medium mb-2">
                          "Monitor my executive inbox and alert me instantly when VIP clients or board members send urgent communications"
                        </p>
                        <div className="flex items-center text-blue-100 text-sm opacity-90">
                          <div className="w-2 h-2 bg-blue-200 rounded-full mr-2" />
                          Executive User • Neural Input Received
                        </div>
                      </div>
                    </div>

                    {/* AI Processing */}
                    <div className="flex justify-start">
                      <div className="max-w-3xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-2xl rounded-bl-lg p-6 shadow-lg">
                        <div className="flex items-center space-x-3 mb-4">
                          <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </div>
                          <span className="text-purple-700 font-semibold">AgentPilot Neural Core</span>
                          <div className="flex space-x-1">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: `${i * 0.1}s`}} />
                            ))}
                          </div>
                        </div>
                        
                        <div className="space-y-3 mb-6">
                          {[
                            "Neural language processing complete",
                            "Executive-level priority algorithms activated",
                            "VIP contact recognition deployed",
                            "Multi-channel notification system configured",
                            "Enterprise security protocols enabled"
                          ].map((step, index) => (
                            <div key={index} className="flex items-center text-green-600">
                              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span className="text-gray-700">{step}</span>
                            </div>
                          ))}
                        </div>

                        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-4 border border-green-200">
                          <div className="flex items-center mb-3">
                            <div className="w-3 h-3 bg-green-500 rounded-full mr-3 animate-pulse" />
                            <span className="text-green-700 font-semibold">Enterprise Agent Successfully Deployed</span>
                          </div>
                          <p className="text-gray-700 font-medium mb-4">
                            Your AI agent is now monitoring your executive communications with advanced VIP recognition and priority routing. 
                            You'll receive instant, contextual alerts for high-priority interactions.
                          </p>
                          <div className="flex justify-between items-center">
                            <div className="flex space-x-4 text-sm text-gray-600">
                              <span className="flex items-center">
                                <div className="w-2 h-2 bg-green-500 rounded-full mr-2" />
                                Live Monitoring
                              </span>
                              <span className="flex items-center">
                                <div className="w-2 h-2 bg-blue-500 rounded-full mr-2" />
                                Enterprise Security
                              </span>
                              <span className="flex items-center">
                                <div className="w-2 h-2 bg-purple-500 rounded-full mr-2" />
                                AI Processing
                              </span>
                            </div>
                            <button className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-700 rounded-lg text-white text-sm font-medium hover:scale-105 transition-transform shadow-lg">
                              Access Dashboard
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Performance Indicator */}
                <div className="text-center mt-6">
                  <div className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-50 to-blue-50 rounded-full border border-green-200 backdrop-blur-sm shadow-lg">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3 animate-pulse" />
                    <span className="text-green-700 font-medium text-lg">Enterprise-grade agent deployed in 6.2 seconds</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Enhanced 3-Step Process */}
            <div className="relative">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {[
                  {
                    number: "01",
                    title: "Neural Input",
                    description: "Describe your workflow in natural language",
                    icon: (
                      <svg className="w-14 h-14 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    ),
                    color: "from-blue-500 to-blue-600",
                    bgColor: "from-blue-50 to-blue-100"
                  },
                  {
                    number: "02",
                    title: "AI Processing",
                    description: "Advanced algorithms build your automation",
                    icon: (
                      <svg className="w-14 h-14 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    ),
                    color: "from-purple-500 to-purple-600",
                    bgColor: "from-purple-50 to-purple-100"
                  },
                  {
                    number: "03",
                    title: "Autonomous Operation",
                    description: "Your agent runs with enterprise reliability",
                    icon: (
                      <svg className="w-14 h-14 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    ),
                    color: "from-cyan-500 to-cyan-600",
                    bgColor: "from-cyan-50 to-cyan-100"
                  }
                ].map((step, index) => (
                  <div key={index} className="text-center group">
                    <div className="relative mb-8">
                      <div className={`w-28 h-28 bg-gradient-to-br ${step.bgColor} rounded-3xl flex items-center justify-center mx-auto shadow-2xl group-hover:scale-110 transition-all duration-500 border border-white/50`}>
                        {step.icon}
                      </div>
                      <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2">
                        <div className={`px-4 py-2 bg-gradient-to-r ${step.color} text-white text-xs font-bold rounded-full shadow-lg`}>
                          {step.number}
                        </div>
                      </div>
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{step.title}</h3>
                    <p className="text-gray-600 text-lg">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Professional CTA */}
            <div className="text-center mt-20">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-200 to-purple-200 rounded-full blur-xl opacity-50" />
                <div className="relative inline-flex items-center px-8 py-4 rounded-full bg-white/90 backdrop-blur-sm border border-blue-200 shadow-lg">
                  <svg className="w-5 h-5 mr-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-lg text-gray-800 font-semibold">
                    Enterprise-ready AI. No technical expertise required.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Professional Use Cases */}
        <section className="py-20 relative bg-gradient-to-b from-white to-gray-50">
          
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-6xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Professional Applications
                </span>
              </h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Trusted by professionals who demand reliability and performance
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                { icon: "🎯", title: "Executive Operations", desc: "Automated KPI monitoring, strategic alerts, and executive briefings" },
                { icon: "📊", title: "Financial Analysis", desc: "Real-time market monitoring, risk assessment, and automated reporting" },
                { icon: "⚖️", title: "Legal & Compliance", desc: "Document review, deadline tracking, and regulatory monitoring" },
                { icon: "🔍", title: "Sales Intelligence", desc: "Lead qualification, pipeline analysis, and client communication" },
                { icon: "⚙️", title: "Operations Management", desc: "Process optimization, resource allocation, and performance tracking" },
                { icon: "🧠", title: "Strategic Planning", desc: "Market analysis, competitor intelligence, and trend identification" }
              ].map((useCase, index) => (
                <div key={index} className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-gray-200 hover:scale-105 transition-all duration-300 group hover:bg-white shadow-lg hover:shadow-xl">
                  <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">{useCase.icon}</div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">{useCase.title}</h3>
                  <p className="text-gray-600">{useCase.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Enterprise Features */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-6xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Enterprise-Grade Platform
                </span>
              </h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Built for professionals who need power, security, and reliability
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-blue-600 rounded-xl flex items-center justify-center mr-4">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900">Enterprise Security</h3>
                </div>
                <p className="text-gray-600 text-lg">End-to-end encryption, SOC 2 compliance, and private cloud deployment options</p>
              </div>

              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-600 rounded-xl flex items-center justify-center mr-4">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900">Unlimited Scale</h3>
                </div>
                <p className="text-gray-600 text-lg">Handle millions of operations with 99.9% uptime and auto-scaling infrastructure</p>
              </div>
            </div>

            <div className="text-center">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { icon: "📧", label: "Executive Inbox" },
                  { icon: "📈", label: "Market Intelligence" },
                  { icon: "🔔", label: "Risk Monitoring" },
                  { icon: "📊", label: "Performance Dashboard" }
                ].map((template, index) => (
                  <div key={index} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl">
                    <div className="text-2xl mb-2">{template.icon}</div>
                    <div className="text-gray-800 font-medium text-sm">{template.label}</div>
                  </div>
                ))}
              </div>
              
              <button className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white px-8 py-4 rounded-full transition-all duration-300 hover:scale-105 text-lg font-medium shadow-lg">
                Explore Professional Templates
              </button>
            </div>
          </div>
        </section>

        {/* Social Proof */}
        <section className="py-20 relative bg-gradient-to-b from-white to-gray-50">
          
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-6xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Trusted by Professionals
                </span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl">
                <p className="text-gray-600 text-lg mb-6 italic">
                  "This platform has revolutionized how we handle client communications. The AI understands context better than any automation tool we've used."
                </p>
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-700 rounded-full flex items-center justify-center mr-4">
                    <span className="text-white font-bold">S</span>
                  </div>
                  <div>
                    <div className="text-gray-900 font-semibold">Senior Partner</div>
                    <div className="text-blue-600 text-sm">Global Consulting Firm</div>
                  </div>
                </div>
              </div>

              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl">
                <p className="text-gray-600 text-lg mb-6 italic">
                  "The natural language interface makes it accessible to our entire team. We've automated 80% of our routine workflows without any technical overhead."
                </p>
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-700 rounded-full flex items-center justify-center mr-4">
                    <span className="text-white font-bold">M</span>
                  </div>
                  <div>
                    <div className="text-gray-900 font-semibold">Chief Operating Officer</div>
                    <div className="text-purple-600 text-sm">Fortune 500 Company</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-blue-50">
          
          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
            <h2 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
              <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                Ready to Deploy?
              </span>
            </h2>
            <p className="text-xl text-gray-600 mb-12">
              Join thousands of professionals already using AI automation
            </p>
            
            <div className="flex flex-col sm:flex-row gap-6 justify-center mb-12">
              <button className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white px-10 py-5 text-lg rounded-2xl transition-all duration-300 hover:scale-105 shadow-2xl font-semibold">
                Start Free Trial
              </button>
              <button className="bg-white/90 backdrop-blur-sm border-2 border-blue-300 text-blue-700 hover:bg-blue-50 px-10 py-5 text-lg rounded-2xl transition-all duration-300 hover:scale-105 font-semibold shadow-lg">
                Schedule Demo
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {['Windows', 'macOS', 'Linux'].map((platform, index) => (
                <div key={index} className="text-center">
                  <div className="text-blue-600 text-sm font-medium">{platform}</div>
                  <div className="text-gray-500 text-xs">Download Available</div>
                </div>
              ))}
            </div>

            <p className="text-gray-500 text-sm">
              Open source under AGPL-3.0 • Enterprise support available • SOC 2 compliant
            </p>
          </div>
        </section>
      </div>

      <style jsx>{`
        @keyframes gridMove {
          0% { background-position: 0 0; }
          100% { background-position: 50px 50px; }
        }
      `}</style>
    </div>
  )
}