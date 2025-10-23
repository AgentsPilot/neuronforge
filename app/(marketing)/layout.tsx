'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { X, Menu } from 'lucide-react'

function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (data.success) {
        setMessage({ type: 'success', text: data.message })
        setEmail('')
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to subscribe' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <h4 className="font-semibold text-white mb-4">Stay Updated</h4>
      <p className="text-gray-400 text-sm mb-4">Subscribe to our newsletter for updates and news.</p>
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          type="email"
          name="email"
          placeholder="Enter your email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Subscribing...' : 'Subscribe'}
        </button>
        {message && (
          <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}
      </form>
    </div>
  )
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Close mobile menu when clicking outside
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isMobileMenuOpen])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Navigation */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 border-b border-white/10 ${
        isScrolled 
          ? 'bg-slate-900/95 backdrop-blur-md shadow-lg' 
          : 'bg-black/20 backdrop-blur-md'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"/>
                </svg>
              </div>
              <span className="text-xl font-bold text-white">AgentsPilot</span>
            </Link>

            {/* Navigation Links */}
            <div className="hidden md:flex items-center space-x-8">
              <Link href="/features" className="text-gray-300 hover:text-white transition-colors duration-200">
                Features
              </Link>
              <Link href="/use-cases" className="text-gray-300 hover:text-white transition-colors duration-200">
                Use Cases
              </Link>
              <Link href="/pricing" className="text-gray-300 hover:text-white transition-colors duration-200">
                Pricing
              </Link>
              <Link href="/about" className="text-gray-300 hover:text-white transition-colors duration-200">
                About
              </Link>
              <Link href="/contact" className="text-gray-300 hover:text-white transition-colors duration-200">
                Contact Us
              </Link>
            </div>

            {/* CTA Buttons - Desktop */}
            <div className="hidden md:flex items-center space-x-4">
              <Link href="/login" className="text-gray-300 hover:text-white transition-colors duration-200">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile menu button */}
            <button
              className="md:hidden text-gray-300 hover:text-white transition-colors duration-200 p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        <div
          className={`md:hidden transition-all duration-300 ease-in-out ${
            isMobileMenuOpen
              ? 'max-h-screen opacity-100'
              : 'max-h-0 opacity-0 overflow-hidden'
          }`}
        >
          <div className="px-4 pt-2 pb-6 space-y-3 bg-slate-900/95 backdrop-blur-md border-t border-white/10">
            <Link
              href="/features"
              className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Features
            </Link>
            <Link
              href="/use-cases"
              className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Use Cases
            </Link>
            <Link
              href="/pricing"
              className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Pricing
            </Link>
            <Link
              href="/about"
              className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              About
            </Link>
            <Link
              href="/contact"
              className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Contact Us
            </Link>

            {/* Mobile CTA Buttons */}
            <div className="pt-4 space-y-3 border-t border-white/10">
              <Link
                href="/login"
                className="block px-4 py-3 text-center text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="block px-4 py-3 text-center bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-16">
        {children}
      </main>

        {/* Footer */}
        <footer className="py-12 bg-black/80 text-gray-300 border-t border-purple-500/30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <div className="flex items-center space-x-2 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                    <div className="w-4 h-4 bg-white rounded-sm"></div>
                  </div>
                  <span className="font-bold text-xl text-white">AgentsPilot</span>
                </div>
                <p className="text-gray-400">The professional AI automation platform.</p>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-4">Product</h4>
                <ul className="space-y-2 text-sm">
                  <li><Link href="/features" className="hover:text-white transition-colors">Features</Link></li>
                  <li><Link href="/use-cases" className="hover:text-white transition-colors">Use Cases</Link></li>
                  <li><Link href="/features#enterprise-integrations" className="hover:text-white transition-colors">Integrations</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-4">Company</h4>
                <ul className="space-y-2 text-sm">
                  <li><Link href="/about" className="hover:text-white transition-colors">About</Link></li>
                  <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                  <li><Link href="/features" className="hover:text-white transition-colors">Features</Link></li>
                  <li><Link href="/contact" className="hover:text-white transition-colors">Contact</Link></li>
                </ul>
              </div>
              {/* Newsletter Signup */}
              <NewsletterForm />
            </div>
            <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
              <p>&copy; 2025 AgentsPilot. All rights reserved. • Privacy Policy • Terms of Service</p>
            </div>
          </div>
        </footer>
      </div>
  )
}