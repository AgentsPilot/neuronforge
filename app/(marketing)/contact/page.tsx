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
                  <span className="text-sm font-medium text-blue-700">Get in Touch • We're Here to Help</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                  <span className="block text-gray-900 mb-2">Let's</span>
                  <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                    Connect
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-4xl mx-auto leading-relaxed">
                  Whether you're ready to get started, need support, or want to explore partnerships, we're here to help you succeed.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Methods */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  How Can We Help?
                </span>
              </h2>
              <p className="text-xl text-gray-600">Choose the best way to reach us based on your needs</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {contactMethods.map((method, index) => (
                <div key={index} className="bg-white/90 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                  <div className="flex items-start space-x-4">
                    <div className="text-4xl">{method.icon}</div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-900 mb-2">{method.title}</h3>
                      <p className="text-gray-600 mb-4">{method.description}</p>
                      
                      <div className="space-y-2">
                        <div className="flex items-center">
                          <span className="text-blue-600 font-medium hover:text-blue-700 cursor-pointer">
                            {method.contact}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-700 font-medium">{method.phone}</span>
                        </div>
                        <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-full inline-block">
                          {method.available}
                        </div>
                      </div>

                      <div className="mt-4">
                        <button className={`w-full py-2 px-4 rounded-lg font-medium transition-all duration-300 hover:scale-105 bg-${method.color}-100 text-${method.color}-700 hover:bg-${method.color}-200`}>
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
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Send Us a Message</h2>
              <p className="text-xl text-gray-600">Fill out the form below and we'll get back to you within 24 hours</p>
            </div>

            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-8 border border-gray-200 shadow-2xl">
              <div className="space-y-6">
                {/* Inquiry Type */}
                <div>
                  <label className="block text-gray-700 font-medium mb-2">What can we help you with?</label>
                  <select
                    name="inquiryType"
                    value={formData.inquiryType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value="general">General Inquiry</option>
                    <option value="sales">Sales & Pricing</option>
                    <option value="support">Technical Support</option>
                    <option value="partnership">Partnership</option>
                    <option value="press">Press & Media</option>
                    <option value="careers">Careers</option>
                    <option value="demo">Schedule Demo</option>
                  </select>
                </div>

                {/* Name Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      placeholder="Doe"
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-gray-700 font-medium mb-2">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    placeholder="john@company.com"
                  />
                </div>

                {/* Company & Role */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">Company</label>
                    <input
                      type="text"
                      name="company"
                      value={formData.company}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      placeholder="Acme Corporation"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">Role</label>
                    <input
                      type="text"
                      name="role"
                      value={formData.role}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      placeholder="CEO, CTO, Manager, etc."
                    />
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-gray-700 font-medium mb-2">
                    Subject <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="subject"
                    value={formData.subject}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    placeholder="How can we help you?"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="block text-gray-700 font-medium mb-2">
                    Message <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    rows={6}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all duration-200"
                    placeholder="Tell us more about your needs, questions, or how we can help..."
                  />
                </div>

                {/* Privacy Notice */}
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <p className="text-sm text-gray-600">
                    By submitting this form, you agree to our privacy policy. We'll only use your information to respond to your inquiry and may occasionally send relevant updates about our platform.
                  </p>
                </div>

                {/* Submit Button */}
                <div className="text-center">
                  <button
                    onClick={handleSubmit}
                    className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-all duration-300 shadow-lg"
                  >
                    Send Message
                  </button>
                  <p className="text-sm text-gray-500 mt-3">
                    We'll respond within 24 hours during business days
                  </p>
                </div>

                {/* Alternative Contact Methods */}
                <div className="border-t border-gray-200 pt-6">
                  <p className="text-center text-gray-600 mb-4">
                    Prefer to reach us directly?
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button className="bg-white border-2 border-blue-300 text-blue-700 px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform">
                      Schedule Demo
                    </button>
                    <button className="bg-white border-2 border-purple-300 text-purple-700 px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform">
                      Call Sales: +1 (555) 123-4567
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Support Channels */}
        <section className="py-20 relative bg-gradient-to-b from-white to-gray-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Multiple Ways to Get Help</h2>
              <p className="text-xl text-gray-600">Choose the support channel that works best for you</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {supportChannels.map((channel, index) => (
                <div key={index} className="bg-white/90 backdrop-blur-sm rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 text-center">
                  <div className="text-3xl mb-4">{channel.icon}</div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{channel.channel}</h3>
                  <p className="text-gray-600 text-sm mb-4">{channel.description}</p>
                  
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">
                      <span className="font-medium">Available:</span> {channel.availability}
                    </div>
                    <div className="text-xs text-gray-500">
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
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Our Global Offices</h2>
              <p className="text-xl text-gray-600">Find us around the world</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {offices.map((office, index) => (
                <div key={index} className="bg-white/90 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300">
                  <div className="text-center">
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">{office.city}</h3>
                    <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full mb-4">
                      {office.type}
                    </div>
                    
                    <div className="space-y-2 text-gray-600 mb-4">
                      <div>{office.address}</div>
                      <div>{office.zipCode}</div>
                      <div className="font-medium">{office.country}</div>
                      <div className="text-blue-600 font-medium">{office.phone}</div>
                      <div className="text-sm text-gray-500">{office.timezone}</div>
                    </div>

                    <p className="text-sm text-gray-600 italic mb-4">{office.description}</p>

                    <button className="w-full bg-blue-100 text-blue-700 py-2 rounded-lg font-medium hover:bg-blue-200 transition-colors">
                      Get Directions
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Frequently Asked Questions
                </span>
              </h2>
              <p className="text-xl text-gray-600">Quick answers to common questions</p>
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
                <div key={index} className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-gray-200 shadow-lg">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">{faq.question}</h3>
                  <p className="text-gray-600">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Response Guarantee */}
        <section className="py-20 relative">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-12 border border-blue-200 shadow-2xl">
              <h2 className="text-4xl font-bold text-gray-900 mb-6">
                We're Here When You Need Us
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                <div>
                  <div className="text-3xl font-bold text-blue-600 mb-2">24h</div>
                  <div className="text-gray-600">Max Response Time</div>
                  <div className="text-sm text-gray-500">Business inquiries</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-purple-600 mb-2">24/7</div>
                  <div className="text-gray-600">Support Available</div>
                  <div className="text-sm text-gray-500">Technical assistance</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-cyan-600 mb-2">3</div>
                  <div className="text-gray-600">Global Offices</div>
                  <div className="text-sm text-gray-500">Worldwide coverage</div>
                </div>
              </div>
              
              <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
                Our global team ensures someone is always available to help, no matter your timezone or urgency level.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button className="bg-gradient-to-r from-blue-600 to-purple-700 text-white px-8 py-4 rounded-xl font-semibold hover:scale-105 transition-transform shadow-lg">
                  Start Your Free Trial
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