'use client'

import { useState, useEffect } from 'react'

interface BlogPost {
  id: string
  title: string
  excerpt: string
  author: string
  date: string
  readTime: string
  category: string
  tags: string[]
  image: string
  featured: boolean
}

export default function BlogPage() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    setIsVisible(true)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const blogPosts: BlogPost[] = [
    {
      id: '1',
      title: 'The Future of Executive Decision Making: How AI Agents Transform C-Suite Operations',
      excerpt: 'Discover how Fortune 500 executives are leveraging AI agents to process information faster, make data-driven decisions, and stay ahead of market changes.',
      author: 'Sarah Chen',
      date: '2024-01-15',
      readTime: '8 min read',
      category: 'Executive Insights',
      tags: ['AI Strategy', 'Leadership', 'Decision Making'],
      image: '📊',
      featured: true
    },
    {
      id: '2',
      title: 'Building Your First AI Agent: A Non-Technical Guide for Professionals',
      excerpt: 'Step-by-step walkthrough for creating intelligent automation without writing code. Perfect for busy professionals who want to get started quickly.',
      author: 'Marcus Rodriguez',
      date: '2024-01-12',
      readTime: '6 min read',
      category: 'Getting Started',
      tags: ['Tutorial', 'No-Code', 'Automation'],
      image: '🚀',
      featured: false
    },
    {
      id: '3',
      title: 'ROI Analysis: Measuring the Business Impact of AI Automation',
      excerpt: 'Real-world case studies showing 300%+ ROI from AI agent implementations. Learn how to calculate and present automation value to stakeholders.',
      author: 'Jennifer Walsh',
      date: '2024-01-10',
      readTime: '12 min read',
      category: 'Business Strategy',
      tags: ['ROI', 'Case Studies', 'Business Value'],
      image: '💼',
      featured: true
    },
    {
      id: '4',
      title: 'Enterprise Security in AI Automation: Best Practices and Compliance',
      excerpt: 'Navigate security requirements, data protection, and compliance standards when implementing AI agents in enterprise environments.',
      author: 'David Kim',
      date: '2024-01-08',
      readTime: '10 min read',
      category: 'Security',
      tags: ['Security', 'Compliance', 'Enterprise'],
      image: '🔐',
      featured: false
    },
    {
      id: '5',
      title: 'Legal Tech Revolution: How Law Firms are Automating Contract Analysis',
      excerpt: 'Inside look at how leading law firms are using AI agents to review contracts, track deadlines, and ensure compliance at scale.',
      author: 'Amanda Foster',
      date: '2024-01-05',
      readTime: '9 min read',
      category: 'Industry Focus',
      tags: ['Legal Tech', 'Contracts', 'Law Firms'],
      image: '⚖️',
      featured: false
    },
    {
      id: '6',
      title: 'The Psychology of AI Adoption: Overcoming Team Resistance to Automation',
      excerpt: 'Practical strategies for introducing AI automation to your team, addressing concerns, and ensuring successful adoption across your organization.',
      author: 'Dr. Lisa Thompson',
      date: '2024-01-03',
      readTime: '7 min read',
      category: 'Team Management',
      tags: ['Change Management', 'Team Adoption', 'Psychology'],
      image: '🧠',
      featured: false
    },
    {
      id: '7',
      title: 'Financial Services Automation: Risk Management in the AI Era',
      excerpt: 'How investment firms and banks are using AI agents for real-time risk assessment, compliance monitoring, and portfolio optimization.',
      author: 'Robert Chang',
      date: '2024-01-01',
      readTime: '11 min read',
      category: 'Industry Focus',
      tags: ['Finance', 'Risk Management', 'Banking'],
      image: '📈',
      featured: false
    },
    {
      id: '8',
      title: 'API Integration Mastery: Connecting Your AI Agents to Any System',
      excerpt: 'Technical guide to integrating AI agents with existing business systems, from CRM platforms to custom databases.',
      author: 'Alex Rivera',
      date: '2023-12-28',
      readTime: '15 min read',
      category: 'Technical',
      tags: ['API', 'Integration', 'Technical'],
      image: '🔧',
      featured: false
    }
  ]

  const categories = [
    'all',
    'Executive Insights',
    'Getting Started',
    'Business Strategy',
    'Security',
    'Industry Focus',
    'Team Management',
    'Technical'
  ]

  const filteredPosts = blogPosts.filter(post => {
    const matchesCategory = selectedCategory === 'all' || post.category === selectedCategory
    const matchesSearch = searchQuery === '' || 
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    
    return matchesCategory && matchesSearch
  })

  const featuredPosts = blogPosts.filter(post => post.featured)

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
                    <span className="text-sm font-medium text-cyan-100">Latest Insights • Industry Expertise</span>
                  </div>

                  <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                    <span className="block text-white mb-2">AI Automation</span>
                    <span className="block bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                      Insights
                    </span>
                  </h1>

                  <p className="text-xl md:text-2xl text-gray-100 mb-12 max-w-4xl mx-auto leading-relaxed">
                    Expert perspectives, practical guides, and industry insights for professionals building the future with AI automation.
                  </p>

                  {/* Search and Filter */}
                  <div className="max-w-2xl mx-auto">
                    <div className="bg-black/50 backdrop-blur-xl rounded-2xl p-6 border border-purple-500/30 shadow-2xl">
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                          <input
                            type="text"
                            placeholder="Search articles, topics, or tags..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                        </div>
                        <select
                          value={selectedCategory}
                          onChange={(e) => setSelectedCategory(e.target.value)}
                          className="px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {categories.map(category => (
                            <option key={category} value={category} className="bg-purple-900 text-white">
                              {category === 'all' ? 'All Categories' : category}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Featured Posts Section */}
          <section className="py-20 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
                    Featured Articles
                  </span>
                </h2>
                <p className="text-xl text-gray-200">Deep insights from industry experts and thought leaders</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {featuredPosts.map((post) => (
                  <article key={post.id} className="bg-purple-900/40 backdrop-blur-sm rounded-2xl border border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                    <div className="p-8">
                      <div className="flex items-center mb-6">
                        <div className="text-4xl mr-4">{post.image}</div>
                        <div>
                          <span className="inline-block px-3 py-1 bg-blue-500/20 text-blue-300 text-sm font-medium rounded-full border border-blue-400/30 mb-2">
                            {post.category}
                          </span>
                          <div className="flex items-center text-sm text-gray-300">
                            <span>{post.author}</span>
                            <span className="mx-2">•</span>
                            <span>{new Date(post.date).toLocaleDateString()}</span>
                            <span className="mx-2">•</span>
                            <span>{post.readTime}</span>
                          </div>
                        </div>
                      </div>

                      <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-cyan-300 transition-colors">
                        {post.title}
                      </h3>

                      <p className="text-gray-200 mb-6 leading-relaxed">
                        {post.excerpt}
                      </p>

                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap gap-2">
                          {post.tags.map((tag, index) => (
                            <span key={index} className="px-2 py-1 bg-purple-800/30 text-gray-300 text-xs rounded-md border border-purple-500/30">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <button className="text-cyan-300 font-medium hover:text-cyan-200 transition-colors">
                          Read More →
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* All Posts Section */}
          <section className="py-20 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  All Articles
                </h2>
                <p className="text-xl text-gray-200">
                  {filteredPosts.length} {filteredPosts.length === 1 ? 'article' : 'articles'}
                  {selectedCategory !== 'all' && ` in ${selectedCategory}`}
                  {searchQuery && ` matching "${searchQuery}"`}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredPosts.map((post) => (
                  <article key={post.id} className="bg-purple-900/40 backdrop-blur-sm rounded-xl border border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                    <div className="p-6">
                      <div className="flex items-center mb-4">
                        <div className="text-3xl mr-3">{post.image}</div>
                        <span className="inline-block px-3 py-1 bg-purple-500/20 text-purple-300 text-sm font-medium rounded-full border border-purple-400/30">
                          {post.category}
                        </span>
                      </div>

                      <h3 className="text-xl font-bold text-white mb-3 group-hover:text-cyan-300 transition-colors leading-tight">
                        {post.title}
                      </h3>

                      <p className="text-gray-200 mb-4 text-sm leading-relaxed">
                        {post.excerpt}
                      </p>

                      <div className="flex flex-wrap gap-1 mb-4">
                        {post.tags.map((tag, index) => (
                          <span key={index} className="px-2 py-1 bg-purple-800/30 text-gray-300 text-xs rounded-md border border-purple-500/30">
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center justify-between text-sm text-gray-300">
                        <div>
                          <span>{post.author}</span>
                          <span className="mx-2">•</span>
                          <span>{post.readTime}</span>
                        </div>
                        <span>{new Date(post.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {filteredPosts.length === 0 && (
                <div className="text-center py-16">
                  <div className="text-6xl mb-4">🔍</div>
                  <h3 className="text-2xl font-bold text-white mb-2">No articles found</h3>
                  <p className="text-gray-200 mb-6">Try adjusting your search or category filter</p>
                  <button 
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedCategory('all')
                    }}
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform"
                  >
                    Clear Filters
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Newsletter Section */}
          <section className="py-20 relative">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="bg-black/50 backdrop-blur-xl rounded-3xl p-12 border border-purple-500/30 shadow-2xl">
                <h2 className="text-4xl font-bold text-white mb-4">
                  Stay Ahead with AI Insights
                </h2>
                <p className="text-xl text-gray-200 mb-8 max-w-2xl mx-auto">
                  Get the latest articles, case studies, and automation strategies delivered to your inbox every week.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    className="flex-1 px-4 py-3 bg-purple-800/30 border border-purple-500/30 rounded-xl text-white placeholder-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform shadow-lg">
                    Subscribe
                  </button>
                </div>
                
                <p className="text-sm text-gray-300 mt-4">
                  Join 10,000+ professionals. Unsubscribe anytime.
                </p>
              </div>
            </div>
          </section>

          {/* Categories Overview */}
          <section className="py-20 relative">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-white mb-4">
                  Explore by Category
                </h2>
                <p className="text-xl text-gray-200">Deep dive into specific areas of AI automation</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {categories.slice(1).map((category) => {
                  const postsInCategory = blogPosts.filter(post => post.category === category).length
                  const categoryIcons = {
                    'Executive Insights': '👔',
                    'Getting Started': '🚀',
                    'Business Strategy': '💼',
                    'Security': '🔐',
                    'Industry Focus': '🏭',
                    'Team Management': '👥',
                    'Technical': '🔧'
                  }
                  
                  return (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className="bg-purple-900/40 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 text-left group"
                    >
                      <div className="text-3xl mb-3">{categoryIcons[category as keyof typeof categoryIcons]}</div>
                      <h3 className="text-lg font-bold text-white mb-2 group-hover:text-cyan-300 transition-colors">
                        {category}
                      </h3>
                      <p className="text-gray-300 text-sm">
                        {postsInCategory} article{postsInCategory !== 1 ? 's' : ''}
                      </p>
                    </button>
                  )
                })}
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