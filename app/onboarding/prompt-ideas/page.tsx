'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Loader2,
  ChevronRight,
  Zap,
  CheckCircle,
  Database,
  HardDrive,
  BarChart
} from 'lucide-react';
import PromptIdeaCard from '@/components/onboarding/PromptIdeaCard';
import { supabase } from '@/lib/supabaseClient';

interface PromptIdea {
  title: string;
  description: string;
  prompt: string;
  category: 'analytics' | 'automation' | 'communication' | 'data' | 'scheduling';
  estimatedTokens: number;
  complexity: 'simple' | 'moderate' | 'advanced';
}

interface Allocation {
  pilot_tokens: number;
  raw_tokens: number;
  tokens_used: number;
  storage_mb: number;
  storage_used_mb: number;
  executions: number | null;
  executions_used: number;
}

export default function PromptIdeasPage() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<PromptIdea[]>([]);
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAllocation, setIsLoadingAllocation] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch allocation
  useEffect(() => {
    const fetchAllocation = async () => {
      try {
        const response = await fetch('/api/onboarding/get-allocation', {
          credentials: 'include', // Use cookies for authentication
        });

        const result = await response.json();

        if (result.success && result.allocation) {
          setAllocation(result.allocation);
        }
      } catch (err) {
        console.error('Error fetching allocation:', err);
      } finally {
        setIsLoadingAllocation(false);
      }
    };

    fetchAllocation();
  }, []);

  // Generate ideas
  useEffect(() => {
    const generateIdeas = async () => {
      try {
        // Get onboarding data from localStorage first
        let goal = localStorage.getItem('onboarding_goal') || '';
        let mode = localStorage.getItem('onboarding_mode') || 'on_demand';
        let role = 'admin';

        // If not in localStorage, try to get from database
        if (!goal) {
          console.log('[Prompt Ideas] No goal in localStorage, fetching from database...');
          const { data: { user } } = await supabase.auth.getUser();

          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('onboarding_goal, onboarding_mode, role')
              .eq('id', user.id)
              .single();

            if (profile) {
              goal = profile.onboarding_goal || '';
              mode = profile.onboarding_mode || 'on_demand';
              role = profile.role || 'admin';
            }
          }
        }

        if (!goal) {
          setError('No goal found. Please complete onboarding first.');
          setIsLoading(false);
          return;
        }

        // Call the prompt ideas generation API
        const response = await fetch('/api/onboarding/generate-prompt-ideas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Include cookies for authentication
          body: JSON.stringify({ goal, mode, role }),
        });

        if (!response.ok) {
          throw new Error('Failed to generate prompt ideas');
        }

        const data = await response.json();

        if (data.success && data.ideas) {
          setIdeas(data.ideas);
          if (data.cached) {
            console.log('[Prompt Ideas] Loaded cached ideas from database');
          } else {
            console.log('[Prompt Ideas] Generated fresh ideas');
          }
        } else {
          throw new Error('Invalid response from server');
        }
      } catch (err) {
        console.error('Error generating ideas:', err);
        setError(err instanceof Error ? err.message : 'Failed to generate ideas');
      } finally {
        setIsLoading(false);
      }
    };

    generateIdeas();
  }, []);

  const handleSkip = () => {
    router.push('/v2/dashboard');
  };

  const handleBrowseTemplates = () => {
    router.push('/v2/dashboard');
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <motion.div
          animate={{
            backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-blue-900/40 via-purple-900/30 to-pink-900/40 bg-[length:200%_200%]"
        />
        <motion.div
          animate={{
            backgroundPosition: ['100% 100%', '0% 0%', '100% 100%'],
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-indigo-900/30 via-transparent to-fuchsia-900/30 bg-[length:200%_200%]"
        />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 py-12 max-w-6xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl mb-6 shadow-2xl">
            <CheckCircle className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400 bg-clip-text text-transparent">
              Welcome to AgentPilot!
            </span>
          </h1>

          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-6">
            Your account is ready with free tier resources. Here are personalized agent ideas based on your goals!
          </p>

          {/* Allocation Display */}
          {!isLoadingAllocation && allocation && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="max-w-4xl mx-auto mb-8"
            >
              <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 border border-blue-500/30 rounded-xl p-6">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  <h3 className="text-lg font-bold text-white">Your Free Tier Allocation</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Pilot Tokens */}
                  <div className="bg-blue-500/20 backdrop-blur-sm border border-blue-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="w-5 h-5 text-blue-400" />
                      <span className="text-sm font-medium text-blue-200">Pilot Tokens</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                      {allocation.pilot_tokens.toLocaleString()}
                    </div>
                    <p className="text-xs text-blue-300 mt-1">
                      0 used
                    </p>
                  </div>

                  {/* Storage */}
                  <div className="bg-green-500/20 backdrop-blur-sm border border-green-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <HardDrive className="w-5 h-5 text-green-400" />
                      <span className="text-sm font-medium text-green-200">Storage</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                      {allocation.storage_mb} MB
                    </div>
                    <p className="text-xs text-green-300 mt-1">
                      0 MB used
                    </p>
                  </div>

                  {/* Executions */}
                  <div className="bg-yellow-500/20 backdrop-blur-sm border border-yellow-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart className="w-5 h-5 text-yellow-400" />
                      <span className="text-sm font-medium text-yellow-200">Executions</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                      {allocation.executions === null ? '∞' : allocation.executions.toLocaleString()}
                    </div>
                    <p className="text-xs text-yellow-300 mt-1">
                      {allocation.executions === null ? 'Unlimited' : '0 used'}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="relative mb-6">
              <Loader2 className="w-16 h-16 text-purple-400 animate-spin" />
              <Sparkles className="w-6 h-6 text-yellow-300 absolute top-0 right-0 animate-pulse" />
            </div>
            <h3 className="text-xl font-semibold text-slate-200 mb-2">Generating Your Ideas...</h3>
            <p className="text-sm text-slate-400">This will only take a few seconds</p>
          </motion.div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md mx-auto"
          >
            <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-red-300 mb-1">Unable to Generate Ideas</h4>
                  <p className="text-xs text-red-400 mb-4">{error}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleBrowseTemplates}
                      className="text-xs px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-300 transition-all duration-200"
                    >
                      Create Agent Manually
                    </button>
                    <button
                      onClick={handleSkip}
                      className="text-xs px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 transition-all duration-200"
                    >
                      Go to Dashboard
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Ideas Grid */}
        {!isLoading && !error && ideas.length > 0 && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8"
            >
              {ideas.map((idea, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                >
                  <PromptIdeaCard
                    idea={idea}
                    index={index}
                    onClick={() => {}} // Non-clickable - ideas are stored for reference only
                  />
                </motion.div>
              ))}
            </motion.div>

            {/* Action Button */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              className="flex justify-center items-center"
            >
              <button
                onClick={handleSkip}
                className="group flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/30 hover:border-purple-400/50 rounded-xl transition-all duration-300 text-purple-200 hover:text-purple-100 text-lg font-semibold"
              >
                <Zap className="w-6 h-6" />
                <span>Go to Dashboard</span>
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
