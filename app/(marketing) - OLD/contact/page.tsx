'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, MapPin, Phone, Send, CheckCircle } from 'lucide-react';

const ContactPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
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
    if (!formData.subject.trim()) {
      setError('Please enter a subject');
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
          subject: formData.subject.trim(),
          message: formData.message.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }

      setIsSubmitted(true);
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <section className="relative py-24 md:py-32 px-4 bg-zinc-950">
          <div className="max-w-4xl mx-auto px-4 lg:px-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8 }}
              className="bg-zinc-900/95 backdrop-blur-2xl p-12 md:p-16 border border-zinc-800 text-center"
            >
              <div className="w-16 h-16 bg-green-500 mx-auto mb-6 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-4">Message Sent!</h1>
              <p className="text-slate-300 mb-8 max-w-md mx-auto">
                Thank you for reaching out. We'll get back to you as soon as possible.
              </p>
              <button
                onClick={() => {
                  setIsSubmitted(false);
                  setError('');
                }}
                className="px-6 py-3 bg-orange-500 hover:bg-orange-600 font-bold text-white transition-all duration-300"
              >
                Send Another Message
              </button>
            </motion.div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center space-y-8"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="space-y-2"
            >
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-black leading-tight">
                <span className="text-orange-400 block">
                  Get in Touch
                </span>
                <span className="text-white block">
                  We're Here to Help
                </span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-base md:text-lg text-slate-300 max-w-4xl mx-auto leading-relaxed"
            >
              Have questions about AgentsPilot? Want to share feedback or discuss your automation needs?
              We'd love to hear from you.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Two-Column Contact Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
            {/* Left Column - Information */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
              <div>
                <h2 className="text-2xl md:text-3xl font-black text-white mb-4">
                  Let's Start a Conversation
                </h2>
                <p className="text-base md:text-lg text-slate-300 leading-relaxed">
                  Whether you're exploring AI automation for the first time or looking to scale your existing workflows,
                  our team is here to help you succeed.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-orange-500/20 border border-orange-400/30 flex items-center justify-center">
                    <Mail className="w-6 h-6 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Email Us</h3>
                    <p className="text-slate-400">support@agentspilot.ai</p>
                    <p className="text-sm text-slate-500 mt-1">We typically respond within 24 hours</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-purple-500/20 border border-purple-400/30 flex items-center justify-center">
                    <MapPin className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Location</h3>
                    <p className="text-slate-400">New York, NY</p>
                    <p className="text-sm text-slate-500 mt-1">Serving customers worldwide</p>
                  </div>
                </div>
              </div>

            </motion.div>

            {/* Right Column - Contact Form */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-zinc-900/90 backdrop-blur-xl p-8 border border-zinc-800 h-full">
                <h3 className="text-xl font-bold text-white mb-6">Send us a Message</h3>

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
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300"
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
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300"
                      placeholder="your@email.com"
                    />
                  </div>

                  {/* Subject Field */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Subject *
                    </label>
                    <input
                      type="text"
                      name="subject"
                      value={formData.subject}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300"
                      placeholder="What can we help you with?"
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
                      rows={6}
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-300 resize-none"
                      placeholder="Tell us about your ideas, feedback, or questions..."
                    />
                    <div className="text-right text-xs text-slate-500 mt-2">
                      {formData.message.length}/1000 characters
                    </div>
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="w-full py-4 px-6 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-white transition-all duration-300 hover:shadow-lg hover:shadow-orange-500/25 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Sending...
                      </>
                    ) : (
                      <>
                        Send Message
                        <Send className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <p className="text-xs text-slate-500 text-center">
                    By submitting this form, you agree to our privacy policy and terms of service.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ContactPage;
