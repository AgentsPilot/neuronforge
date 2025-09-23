'use client'

import { useState, useEffect } from 'react'

export default function ContactPage() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
    role: '',
    subject: '',
    message: '',
    inquiryType: 'general'
  })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    setIsVisible(true)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSubmit = (e: React.MouseEvent) => {
    e.preventDefault()
    console.log('Form submitted:', formData)
    // Handle form submission logic here
  }

  const contactMethods = [
    {
      title: 'Sales Inquiries',
      description: 'Ready to get started or need a custom solution?',
      contact: 'sales@agentpilot.ai',
      phone: '+1 (555) 123-4567',
      icon: '💼',
      available: '9 AM - 6 PM PST, Mon-Fri',
      color: 'blue'
    },
    {
      title: 'Technical Support',
      description: 'Need help with your existing setup?',
      contact: 'support@agentpilot.ai',
      phone: '+1 (555) 123-4568',
      icon: '🔧',
      available: '24/7 Support Available',
      color: 'purple'
    },
    {
      title: 'Partnerships',
      description: 'Interested in partnering with us?',
      contact: 'partnerships@agentpilot.ai',
      phone: '+1 (555) 123-4569',
      icon: '🤝',
      available: '9 AM - 6 PM PST, Mon-Fri',
      color: 'green'
    },
    {
      title: 'Media & Press',
      description: 'Press inquiries and media requests',
      contact: 'press@agentpilot.ai',
      phone: '+1 (555) 123-4570',
      icon: '📰',
      available: '9 AM - 5 PM PST, Mon-Fri',
      color: 'cyan'
    }
  ]

  const offices = [
    {
      city: 'San Francisco',
      address: '123 Market Street, Suite 1000',
      zipCode: 'San Francisco, CA 94105',
      country: 'United States',
      phone: '+1 (555) 123-4567',
      type: 'Headquarters',
      timezone: 'PST (UTC-8)',
      description: 'Our main headquarters where it all began'
    },
    {
      city: 'London',
      address: '25 Old Broad Street, Level 15',
      zipCode: 'London EC2N 1HQ',
      country: 'United Kingdom',
      phone: '+44 20 7946 0958',
      type: 'European Office',
      timezone: 'GMT (UTC+0)',
      description: 'Serving our European customers and partners'
    },
    {
      city: 'Singapore',
      address: '1 Marina Bay, Tower 2, Level 30',
      zipCode: 'Singapore 018989',
      country: 'Singapore',
      phone: '+65 6789 1234',
      type: 'Asia-Pacific Office',
      timezone: 'SGT (UTC+8)',
      description: 'Supporting the rapidly growing APAC market'
    }
  ]

  const supportChannels = [
    {
      channel: 'Live Chat',
      description: 'Instant support for quick questions',
      availability: '24/7',
      responseTime: 'Immediate',
      icon: '💬'
    },
    {
      channel: 'Email Support',
      description: 'Detailed technical assistance',
      availability: '24/7',
      responseTime: '< 4 hours',
      icon: '📧'
    },
    {
      channel: 'Phone Support',
      description: 'Direct line to our experts',
      availability: 'Business Hours',
      responseTime: 'Immediate',
      icon: '📞'
    },
    {
      channel: 'Knowledge Base',
      description: 'Self-service documentation',
      availability: '24/7',
      responseTime: 'Self-serve',
      icon: '📚'
    }
  ]

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
                    <span className="text-sm font-medium text-cyan-100">Get in Touch • We're Here to Help</span>
                  </div>

                  <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                    <span className="block text-white mb-2">Let's</span>
                    <span className="block bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                      Connect
                    </span>
                  </h1>

                  <p className="text-xl md:text-2xl text-gray-100 mb-12 max-w-4xl mx-auto leading-relaxed">
                    Whether you're ready to get started, need support, or want to explore partnerships, we're here to help you succeed.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Contact Methods */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                    How Can We Help?
                  </span>
                </h2>
                <p className="text-xl text-gray-200">Choose the best way to reach us based on your needs</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {contactMethods.map((method, index) => (
                  <div key={index} className="bg-purple-900/40 backdrop-blur-sm rounded-2xl p-8 border border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                    <div className="flex items-start space-x-4">
                      <div className="text-4xl">{method.icon}</div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white mb-2">{method.title}</h3>
                        <p className="text-gray-200 mb-4">{method.description}</p>
                        
                        <div className="space-y-2">
                          <div className="flex items-center">
                            <span className="text-cyan-300 font-medium hover:text-cyan-200 cursor-pointer">
                              {method.contact}
                            </span>
                          </div>
                          <div className="flex items-center">
                            <span className="text-gray-200 font-medium">{method.phone}</span>
                          </div>
                          <div className="text-sm text-gray-300 bg-purple-800/30 px-3 py-1 rounded-full inline-block border border-purple-500/30">
                            {method.available}
                          </div>
                        </div>

                        <div className="mt-4">
                          <button className="w-full py-2 px-4 rounded-lg font-medium transition-all duration-300 hover:scale-105 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700">
                            Contact {method.title.split(' ')[0]}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Contact Form */}
          <section className="py-20 relative">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">Send Us a Message</h2>
                <p className="text-xl text-gray-200">Fill out the form below and we'll get back to you within 24 hours</p>
              </div>

              <div className="bg-black/50 backdrop-blur-xl rounded-3xl p-8 border border-purple-500/30 shadow-2xl">
                <div className="space-y-6">
                  {/* Inquiry Type */}
                  <div>
                    <label className="block text-gray-200 font-medium mb-2">What can we help you with?</label>
                    <select
                      name="inquiryType"
                      value={formData.inquiryType}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="general" className="bg-purple-900 text-white">General Inquiry</option>
                      <option value="sales" className="bg-purple-900 text-white">Sales & Pricing</option>
                      <option value="support" className="bg-purple-900 text-white">Technical Support</option>
                      <option value="partnership" className="bg-purple-900 text-white">Partnership</option>
                      <option value="press" className="bg-purple-900 text-white">Press & Media</option>
                      <option value="careers" className="bg-purple-900 text-white">Careers</option>
                      <option value="demo" className="bg-purple-900 text-white">Schedule Demo</option>
                    </select>
                  </div>

                  {/* Name Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-gray-200 font-medium mb-2">
                        First Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-200 font-medium mb-2">
                        Last Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                        placeholder="Doe"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-gray-200 font-medium mb-2">
                      Email Address <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                      placeholder="john@company.com"
                    />
                  </div>

                  {/* Company & Role */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-gray-200 font-medium mb-2">Company</label>
                      <input
                        type="text"
                        name="company"
                        value={formData.company}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                        placeholder="Acme Corporation"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-200 font-medium mb-2">Role</label>
                      <input
                        type="text"
                        name="role"
                        value={formData.role}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                        placeholder="CEO, CTO, Manager, etc."
                      />
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-gray-200 font-medium mb-2">
                      Subject <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      name="subject"
                      value={formData.subject}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                      placeholder="How can we help you?"
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <label className="block text-gray-200 font-medium mb-2">
                      Message <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      name="message"
                      value={formData.message}
                      onChange={handleInputChange}
                      rows={6}
                      className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none transition-all duration-200"
                      placeholder="Tell us more about your needs, questions, or how we can help..."
                    />
                  </div>

                  {/* Privacy Notice */}
                  <div className="bg-blue-900/30 rounded-xl p-4 border border-blue-500/30">
                    <p className="text-sm text-gray-200">
                      By submitting this form, you agree to our privacy policy. We'll only use your information to respond to your inquiry and may occasionally send relevant updates about our platform.
                    </p>
                  </div>

                  {/* Submit Button */}
                  <div className="text-center">
                    <button
                      onClick={handleSubmit}
                      className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-all duration-300 shadow-lg"
                    >
                      Send Message
                    </button>
                    <p className="text-sm text-gray-300 mt-3">
                      We'll respond within 24 hours during business days
                    </p>
                  </div>

                  {/* Alternative Contact Methods */}
                  <div className="border-t border-purple-500/30 pt-6">
                    <p className="text-center text-gray-200 mb-4">
                      Prefer to reach us directly?
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                      <button className="border-2 border-cyan-400/50 text-cyan-300 hover:bg-cyan-800/30 px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform backdrop-blur-sm">
                        Schedule Demo
                      </button>
                      <button className="border-2 border-purple-400/50 text-purple-300 hover:bg-purple-800/30 px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform backdrop-blur-sm">
                        Call Sales: +1 (555) 123-4567
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Support Channels */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">Multiple Ways to Get Help</h2>
                <p className="text-xl text-gray-200">Choose the support channel that works best for you</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {supportChannels.map((channel, index) => (
                  <div key={index} className="bg-purple-900/40 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300 text-center">
                    <div className="text-3xl mb-4">{channel.icon}</div>
                    <h3 className="text-lg font-bold text-white mb-2">{channel.channel}</h3>
                    <p className="text-gray-200 text-sm mb-4">{channel.description}</p>
                    
                    <div className="space-y-2">
                      <div className="text-xs text-gray-300">
                        <span className="font-medium">Available:</span> {channel.availability}
                      </div>
                      <div className="text-xs text-gray-300">
                        <span className="font-medium">Response:</span> {channel.responseTime}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Office Locations */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">Our Global Offices</h2>
                <p className="text-xl text-gray-200">Find us around the world</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {offices.map((office, index) => (
                  <div key={index} className="bg-purple-900/40 backdrop-blur-sm rounded-2xl p-8 border border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="text-center">
                      <h3 className="text-2xl font-bold text-white mb-2">{office.city}</h3>
                      <div className="inline-block px-3 py-1 bg-blue-500/20 text-blue-300 text-sm rounded-full border border-blue-400/30 mb-4">
                        {office.type}
                      </div>
                      
                      <div className="space-y-2 text-gray-200 mb-4">
                        <div>{office.address}</div>
                        <div>{office.zipCode}</div>
                        <div className="font-medium">{office.country}</div>
                        <div className="text-cyan-300 font-medium">{office.phone}</div>
                        <div className="text-sm text-gray-300">{office.timezone}</div>
                      </div>

                      <p className="text-sm text-gray-200 italic mb-4">{office.description}</p>

                      <button className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white py-2 rounded-lg font-medium hover:from-cyan-600 hover:to-blue-700 transition-colors">
                        Get Directions
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* FAQ Section */}
          <section className="py-20 relative">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                    Frequently Asked Questions
                  </span>
                </h2>
                <p className="text-xl text-gray-200">Quick answers to common questions</p>
              </div>

              <div className="space-y-6">
                {[
                  {
                    question: "How quickly do you respond to inquiries?",
                    answer: "We respond to all inquiries within 24 hours during business days. For urgent technical support matters, our 24/7 support team is available via live chat and phone."
                  },
                  {
                    question: "Do you offer custom enterprise solutions?",
                    answer: "Yes, we work closely with enterprise clients to create custom solutions that meet their specific needs, including on-premise deployments, custom integrations, and dedicated support."
                  },
                  {
                    question: "Can I schedule a personalized demo?",
                    answer: "Absolutely! You can schedule a personalized demo by selecting 'Schedule Demo' in the contact form above, or by contacting our sales team directly. We'll tailor the demo to your specific use case."
                  },
                  {
                    question: "What support options are available?",
                    answer: "We offer multiple support channels: 24/7 live chat, email support with <4 hour response time, phone support during business hours, and a comprehensive knowledge base for self-service."
                  },
                  {
                    question: "How do I become a partner?",
                    answer: "We're always looking for strategic partners. Contact our partnerships team to discuss integration opportunities, reseller programs, and technology partnerships."
                  },
                  {
                    question: "Do you have offices I can visit?",
                    answer: "Yes, we have offices in San Francisco (HQ), London, and Singapore. While we encourage reaching out first, we welcome visitors by appointment at any of our locations."
                  }
                ].map((faq, index) => (
                  <div key={index} className="bg-purple-900/40 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30 shadow-lg hover:shadow-purple-500/25">
                    <h3 className="text-lg font-semibold text-white mb-3">{faq.question}</h3>
                    <p className="text-gray-200">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Response Guarantee */}
          <section className="py-20 relative">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="bg-black/50 backdrop-blur-xl rounded-3xl p-12 border border-purple-500/30 shadow-2xl">
                <h2 className="text-4xl font-bold text-white mb-6">
                  We're Here When You Need Us
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                  <div>
                    <div className="text-3xl font-bold text-blue-300 mb-2">24h</div>
                    <div className="text-gray-200">Max Response Time</div>
                    <div className="text-sm text-gray-300">Business inquiries</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-purple-300 mb-2">24/7</div>
                    <div className="text-gray-200">Support Available</div>
                    <div className="text-sm text-gray-300">Technical assistance</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-cyan-300 mb-2">3</div>
                    <div className="text-gray-200">Global Offices</div>
                    <div className="text-sm text-gray-300">Worldwide coverage</div>
                  </div>
                </div>
                
                <p className="text-gray-200 mb-8 max-w-2xl mx-auto">
                  Our global team ensures someone is always available to help, no matter your timezone or urgency level.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg">
                    Start Your Free Trial
                  </button>
                  <button className="border-2 border-cyan-400/50 text-cyan-300 hover:bg-cyan-800/30 px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform backdrop-blur-sm">
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