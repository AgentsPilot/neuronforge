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
                  <span className="text-sm font-medium text-blue-700">Latest Insights • Industry Expertise</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight">
                  <span className="block text-gray-900 mb-2">AI Automation</span>
                  <span className="block bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                    Insights
                  </span>
                </h1>

                <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-4xl mx-auto leading-relaxed">
                  Expert perspectives, practical guides, and industry insights for professionals building the future with AI automation.
                </p>

                {/* Search and Filter */}
                <div className="max-w-2xl mx-auto">
                  <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-gray-200 shadow-lg">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Search articles, topics, or tags..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {categories.map(category => (
                          <option key={category} value={category}>
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
        <section className="py-20 relative bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                  Featured Articles
                </span>
              </h2>
              <p className="text-xl text-gray-600">Deep insights from industry experts and thought leaders</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {featuredPosts.map((post) => (
                <article key={post.id} className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                  <div className="p-8">
                    <div className="flex items-center mb-6">
                      <div className="text-4xl mr-4">{post.image}</div>
                      <div>
                        <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full mb-2">
                          {post.category}
                        </span>
                        <div className="flex items-center text-sm text-gray-500">
                          <span>{post.author}</span>
                          <span className="mx-2">•</span>
                          <span>{new Date(post.date).toLocaleDateString()}</span>
                          <span className="mx-2">•</span>
                          <span>{post.readTime}</span>
                        </div>
                      </div>
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors">
                      {post.title}
                    </h3>

                    <p className="text-gray-600 mb-6 leading-relaxed">
                      {post.excerpt}
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-2">
                        {post.tags.map((tag, index) => (
                          <span key={index} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button className="text-blue-600 font-medium hover:text-blue-700 transition-colors">
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
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                All Articles
              </h2>
              <p className="text-xl text-gray-600">
                {filteredPosts.length} {filteredPosts.length === 1 ? 'article' : 'articles'}
                {selectedCategory !== 'all' && ` in ${selectedCategory}`}
                {searchQuery && ` matching "${searchQuery}"`}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredPosts.map((post) => (
                <article key={post.id} className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 group">
                  <div className="p-6">
                    <div className="flex items-center mb-4">
                      <div className="text-3xl mr-3">{post.image}</div>
                      <span className="inline-block px-3 py-1 bg-purple-100 text-purple-700 text-sm font-medium rounded-full">
                        {post.category}
                      </span>
                    </div>

                    <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors leading-tight">
                      {post.title}
                    </h3>

                    <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                      {post.excerpt}
                    </p>

                    <div className="flex flex-wrap gap-1 mb-4">
                      {post.tags.map((tag, index) => (
                        <span key={index} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-sm text-gray-500">
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
                <h3 className="text-2xl font-bold text-gray-900 mb-2">No articles found</h3>
                <p className="text-gray-600 mb-6">Try adjusting your search or category filter</p>
                <button 
                  onClick={() => {
                    setSearchQuery('')
                    setSelectedCategory('all')
                  }}
                  className="bg-gradient-to-r from-blue-600 to-purple-700 text-white px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Newsletter Section */}
        <section className="py-20 relative bg-gradient-to-b from-white to-blue-50">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-12 border border-blue-200 shadow-2xl">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Stay Ahead with AI Insights
              </h2>
              <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                Get the latest articles, case studies, and automation strategies delivered to your inbox every week.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button className="bg-gradient-to-r from-blue-600 to-purple-700 text-white px-6 py-3 rounded-xl font-medium hover:scale-105 transition-transform shadow-lg">
                  Subscribe
                </button>
              </div>
              
              <p className="text-sm text-gray-500 mt-4">
                Join 10,000+ professionals. Unsubscribe anytime.
              </p>
            </div>
          </div>
        </section>

        {/* Categories Overview */}
        <section className="py-20 relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Explore by Category
              </h2>
              <p className="text-xl text-gray-600">Deep dive into specific areas of AI automation</p>
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
                    className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 text-left group"
                  >
                    <div className="text-3xl mb-3">{categoryIcons[category as keyof typeof categoryIcons]}</div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                      {category}
                    </h3>
                    <p className="text-gray-600 text-sm">
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
        @keyframes gridMove {
          0% { background-position: 0 0; }
          100% { background-position: 50px 50px; }
        }
      `}</style>
    </div>
  )
}