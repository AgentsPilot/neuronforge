'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';

const ContactPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

const handleSubmit = async () => {
  setError('');

  // Validation
  if (!formData.name.trim()) {
    setError('Please enter your name');
    return;
  }
  if (!formData.email.trim()) {
    setError('Please enter your email');
    return;
  }
  if (!validateEmail(formData.email)) {
    setError('Please enter a valid email address');
    return;
  }
  if (!formData.message.trim()) {
    setError('Please enter a message');
    return;
  }
  if (formData.message.length > 1000) {
    setError('Message must be under 1000 characters');
    return;
  }

  setIsSubmitting(true);

  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: formData.name.trim(),
        email: formData.email.trim(),
        message: formData.message.trim(),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to send message');
    }

    setIsSubmitted(true);
    setFormData({ name: '', email: '', message: '' });
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
  } finally {
    setIsSubmitting(false);
  }
};

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white overflow-hidden">
        {/* Background Effects */}
        <div className="fixed inset-0 pointer-events-none">
          <motion.div
            animate={{
              backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
            }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-orange-900/20 via-zinc-900/30 to-transparent bg-[length:200%_200%]"
          />
          <motion.div
            animate={{
              backgroundPosition: ['100% 100%', '0% 0%', '100% 100%'],
            }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-orange-900/15 via-transparent to-transparent bg-[length:200%_200%]"
          />
          <motion.div
            animate={{
              x: [0, 150, 0],
              y: [0, -150, 0],
              scale: [1, 1.3, 1],
              opacity: [0.15, 0.3, 0.15]
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-20 left-20 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              x: [0, -150, 0],
              y: [0, 150, 0],
              scale: [1, 1.4, 1],
              opacity: [0.15, 0.3, 0.15]
            }}
            transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl"
          />
          <motion.div
            animate={{
              x: [0, 100, -100, 0],
              y: [0, -100, 100, 0],
              scale: [1, 1.2, 1.3, 1],
              opacity: [0.1, 0.2, 0.15, 0.1]
            }}
            transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/8 rounded-full blur-3xl"
          />
        </div>

        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="relative group max-w-md w-full"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 rounded-3xl opacity-75 blur-2xl"></div>
            <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 border border-white/20 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full mx-auto mb-6 flex items-center justify-center">
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white mb-4">Message Sent!</h1>
              <p className="text-slate-300 mb-8">
                Thanks! We'll get back to you soon.
              </p>
              <button
                onClick={() => {
                  setIsSubmitted(false);
                  setError('');
                }}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-semibold text-white hover:shadow-lg transition-all duration-300"
              >
                Send Another Message
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <motion.div
          animate={{
            backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-orange-900/20 via-zinc-900/30 to-transparent bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            backgroundPosition: ['100% 100%', '0% 0%', '100% 100%'],
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-orange-900/15 via-transparent to-transparent bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            x: [0, 150, 0],
            y: [0, -150, 0],
            scale: [1, 1.3, 1],
            opacity: [0.15, 0.3, 0.15]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-20 left-20 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -150, 0],
            y: [0, 150, 0],
            scale: [1, 1.4, 1],
            opacity: [0.15, 0.3, 0.15]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, 100, -100, 0],
            y: [0, -100, 100, 0],
            scale: [1, 1.2, 1.3, 1],
            opacity: [0.1, 0.2, 0.15, 0.1]
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/8 rounded-full blur-3xl"
        />
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 lg:px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-lg"
        >
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-black mb-4">
              <span className="text-orange-400">
                Get in Touch
              </span>
            </h1>
            <p className="text-base md:text-lg text-slate-300 leading-relaxed">
              AgentPilot is still in early access — your feedback and ideas matter.
            </p>
          </div>

          {/* Contact Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-orange-500 rounded-3xl opacity-50 group-hover:opacity-75 blur-2xl transition duration-1000"></div>
            <div className="relative bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-2xl rounded-3xl p-8 border border-white/20">
              <div className="space-y-6">
                {/* Name Field */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300"
                    placeholder="Your name"
                  />
                </div>

                {/* Email Field */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300"
                    placeholder="your@email.com"
                  />
                </div>

                {/* Message Field */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Message *
                  </label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    maxLength={1000}
                    rows={5}
                    className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300 resize-none"
                    placeholder="Tell us about your ideas, feedback, or questions..."
                  />
                  <div className="text-right text-xs text-slate-400 mt-2">
                    {formData.message.length}/1000 characters
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="w-full py-4 px-6 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-white transition-all duration-300 hover:shadow-lg hover:shadow-orange-500/25"
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Sending...
                    </div>
                  ) : (
                    'Send Message'
                  )}
                </button>
              </div>
            </div>
          </motion.div>

          {/* Direct Contact */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="text-center mt-8"
          >
            <p className="text-slate-400">
              Prefer email? You can reach us at{' '}
              <span className="text-orange-400 font-medium">support@agentspilot.ai</span>
            </p>
          </motion.div>
        </motion.div>
      </div>

    </div>
  );
};

export default ContactPage;