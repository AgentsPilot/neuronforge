'use client'

import { useState, useEffect } from 'react'

export default function AboutPage() {
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

  const teamMembers = [
    {
      name: 'Sarah Chen',
      role: 'CEO & Co-Founder',
      background: 'Former VP of AI at Microsoft, 15+ years in enterprise software',
      image: '👩‍💼',
      expertise: ['AI Strategy', 'Enterprise Sales', 'Product Vision']
    },
    {
      name: 'Marcus Rodriguez',
      role: 'CTO & Co-Founder', 
      background: 'Ex-Google AI Research, PhD in Machine Learning from Stanford',
      image: '👨‍💻',
      expertise: ['AI Architecture', 'Scalable Systems', 'Natural Language Processing']
    },
    {
      name: 'Jennifer Walsh',
      role: 'VP of Engineering',
      background: 'Former Principal Engineer at Amazon, built systems serving billions',
      image: '👩‍🔬',
      expertise: ['Cloud Architecture', 'DevOps', 'Platform Engineering']
    },
    {
      name: 'David Kim',
      role: 'Head of Security',
      background: 'Ex-Palantir Security Lead, certified in enterprise compliance',
      image: '👨‍🔒',
      expertise: ['Cybersecurity', 'Compliance', 'Risk Management']
    }
  ]

  const milestones = [
    {
      year: '2022',
      title: 'Company Founded',
      description: 'Started with a vision to democratize AI automation for professionals'
    },
    {
      year: '2023',
      title: 'Series A Funding',
      description: '$15M raised from leading VCs to accelerate product development'
    },
    {
      year: '2023',
      title: 'First Enterprise Customers',
      description: 'Fortune 500 companies begin automating critical workflows'
    },
    {
      year: '2024',
      title: 'Platform Launch',
      description: 'Public launch with 500+ integrations and enterprise features'
    },
    {
      year: '2024',
      title: 'Global Expansion',
      description: 'Opened offices in London and Singapore, serving 50+ countries'
    }
  ]

  const values = [
    {
      title: 'Democratize AI',
      description: 'Making powerful AI automation accessible to every professional, regardless of technical background',
      icon: '🌍'
    },
    {
      title: 'Enterprise First',
      description: 'Building with security, compliance, and scalability as core principles from day one',
      icon: '🏢'
    },
    {
      title: 'Human-Centric',
      description: 'AI should amplify human capabilities, not replace human judgment and creativity',
      icon: '🤝'
    },
    {
      title: 'Transparency',
      description: 'Open about our processes, pricing, and limitations. No black boxes or hidden agendas',
      icon: '🔍'
    }
  ]

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
            backgroundSize: '50px 50px',
            animation: 'gridMove 20s linear infinite'
          }}
        />
      </div>

      {/* Subtle Interactive Mouse Glow */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none transition-all duration-300"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(59, 130, 246, 0.04), transparent 50%)`
        }}
      />

      <div className="relative z-10">
        {/* Header Section */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
              <div className="text-center mb-16">
                <div className="inline-flex items-center px-6 py-3 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 backdrop-blur-sm mb-8 shadow-lg">
                  <span className="text-sm font-medium text-blue-700">Our Story • Our Mission</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                  <span className="block text-gray-900 mb-2">Building the</span>
                  <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                    Future of Work
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-4xl mx-auto leading-relaxed">
                  We're on a mission to democratize AI automation, making intelligent workflows accessible to every professional and organization.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Mission Statement */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-12 border border-gray-200 shadow-2xl">
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold text-gray-900 mb-6">Our Mission</h2>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Democratizing AI Automation</h3>
                  <p className="text-gray-600 text-lg leading-relaxed mb-6">
                    We believe every professional should have access to powerful AI automation, regardless of their technical background. 
                    Traditional automation tools require coding skills and technical expertise that most professionals don't have.
                  </p>
                  <p className="text-gray-600 text-lg leading-relaxed">
                    AgentPilot changes that by letting you describe what you want in plain English and automatically building 
                    intelligent workflows that integrate with your existing tools and processes.
                  </p>
                </div>
                
                <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-8 border border-blue-200">
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-blue-600 mb-2">10,000+</div>
                      <div className="text-gray-600">Professionals Automated</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-purple-600 mb-2">500+</div>
                      <div className="text-gray-600">Enterprise Integrations</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-cyan-600 mb-2">99.9%</div>
                      <div className="text-gray-600">Platform Uptime</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Company Values */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Our Values
                </span>
              </h2>
              <p className="text-xl text-gray-600">The principles that guide everything we do</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {values.map((value, index) => (
                <div key={index} className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300">
                  <div className="flex items-start space-x-4">
                    <div className="text-4xl">{value.icon}</div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-3">{value.title}</h3>
                      <p className="text-gray-600 leading-relaxed">{value.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>


        {/* Company Timeline */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Our Journey</h2>
              <p className="text-xl text-gray-600">Key milestones in building the future of work</p>
            </div>

            <div className="relative">
              <div className="absolute left-1/2 transform -translate-x-1/2 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-600"></div>
              
              <div className="space-y-12">
                {milestones.map((milestone, index) => (
                  <div key={index} className={`flex items-center ${index % 2 === 0 ? 'flex-row' : 'flex-row-reverse'}`}>
                    <div className={`w-5/12 ${index % 2 === 0 ? 'text-right pr-8' : 'text-left pl-8'}`}>
                      <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 border border-gray-200 shadow-lg">
                        <div className="text-2xl font-bold text-blue-600 mb-2">{milestone.year}</div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">{milestone.title}</h3>
                        <p className="text-gray-600">{milestone.description}</p>
                      </div>
                    </div>
                    
                    <div className="w-2/12 flex justify-center">
                      <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full border-4 border-white shadow-lg"></div>
                    </div>
                    
                    <div className="w-5/12"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Investors & Partners */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Backed by Leading Investors</h2>
              <p className="text-xl text-gray-600">Trusted by top-tier venture capital firms and industry experts</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { name: 'Sequoia Capital', category: 'Lead Investor' },
                { name: 'Andreessen Horowitz', category: 'Series A' },
                { name: 'GV (Google Ventures)', category: 'Strategic' },
                { name: 'Salesforce Ventures', category: 'Strategic' }
              ].map((investor, index) => (
                <div key={index} className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-gray-200 shadow-lg text-center">
                  <div className="text-2xl font-bold text-gray-900 mb-2">{investor.name}</div>
                  <div className="text-sm text-gray-600">{investor.category}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Culture & Benefits */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Join Our Team
                </span>
              </h2>
              <p className="text-xl text-gray-600">Building the future of work requires the best talent</p>
            </div>

            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-12 border border-gray-200 shadow-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Why Work Here?</h3>
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-4"></div>
                      <span className="text-gray-600">Work on cutting-edge AI technology</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-purple-500 rounded-full mr-4"></div>
                      <span className="text-gray-600">Competitive salary and equity</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-cyan-500 rounded-full mr-4"></div>
                      <span className="text-gray-600">Flexible remote work options</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-4"></div>
                      <span className="text-gray-600">Comprehensive health benefits</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mr-4"></div>
                      <span className="text-gray-600">Professional development budget</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Open Positions</h3>
                  <div className="space-y-3">
                    {[
                      'Senior AI Engineer',
                      'Product Manager - Enterprise',
                      'DevOps Engineer',
                      'Customer Success Manager',
                      'Sales Development Representative'
                    ].map((position, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-700 font-medium">{position}</span>
                        <button className="text-blue-600 hover:text-blue-700 font-medium text-sm">
                          Apply →
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-6">
                    <button className="w-full bg-gradient-to-r from-blue-600 to-purple-700 text-white py-3 rounded-xl font-semibold hover:scale-105 transition-transform">
                      View All Careers
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact CTA */}
        <section className="py-20 relative bg-gradient-to-b from-white to-blue-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-12 border border-blue-200 shadow-2xl">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Want to Learn More?
              </h2>
              <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                We'd love to hear from you. Whether you're interested in our platform, partnerships, or joining our team.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button className="bg-gradient-to-r from-blue-600 to-purple-700 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg">
                  Contact Us
                </button>
                <button className="bg-white border-2 border-blue-300 text-blue-700 px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform">
                  Schedule Demo
                </button>
              </div>
            </div>
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