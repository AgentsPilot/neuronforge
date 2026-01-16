'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Brain,
  MessageSquare,
  Bot,
  CheckCircle,
  ArrowRight,
  Play,
  Pause,
  Sparkles,
  BookOpen,
  Settings,
  Loader,
  Zap,
  Speaker,
  Lock,
  Calendar as CalendarIcon,
  Volume2,
  Clock,
  FileText,
  HardDrive,
  FileSearch,
  Link,
  BarChart3,
  Rocket,
  Workflow,
  Repeat,
  Network,
  Headphones,
  Receipt,
  ShoppingCart,
  Users,
  Package,
  Shield,
  MessageCircle,
  CalendarClock,
  Send,
  Database,
  Calendar,
  TrendingUp,
  CheckSquare
} from 'lucide-react';
import { PluginIcon } from '@/components/PluginIcon';

// ============================================================================
// HERO ANIMATION COMPONENTS
// ============================================================================

type AnimationStep = 'typing' | 'building' | 'connecting' | 'dashboard' | 'tagline';

const Icon = ({ type, label, pulse = false, delay = 0 }: { type: 'mail' | 'brain' | 'slack'; label: string; pulse?: boolean; delay?: number }) => {
  const iconComponents = {
    mail: Mail,
    brain: Brain,
    slack: MessageSquare,
  };

  const IconComponent = iconComponents[type];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0
      }}
      transition={{
        duration: 0.5,
        delay
      }}
      className="flex flex-col items-center gap-2 md:gap-3 relative"
    >
      {pulse && (
        <motion.div
          animate={{
            opacity: [0.2, 0.4, 0.2],
            scale: [1, 1.3, 1],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute inset-0 bg-orange-500 rounded-2xl md:rounded-3xl blur-xl md:blur-2xl"
        />
      )}

      <div className="relative w-16 h-16 md:w-24 md:h-24 bg-zinc-800/90 backdrop-blur-xl rounded-2xl md:rounded-3xl flex items-center justify-center shadow-xl md:shadow-2xl border border-white/20">
        <div className="absolute inset-1 md:inset-2 bg-orange-500/10 rounded-xl md:rounded-2xl blur-sm" />

        <IconComponent className="w-10 h-10 text-orange-500" />
      </div>

      <span className="text-xs md:text-sm text-slate-300 font-bold">
        {label}
      </span>
    </motion.div>
  );
};

const Arrow = ({ delay = 0 }: { delay?: number }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.5, delay }}
    className="flex items-center relative hidden md:flex"
  >
    <div className="w-12 md:w-24 h-1 md:h-1.5 bg-orange-500 rounded-full relative overflow-hidden">
      <div className="w-0 h-0 border-t-[6px] md:border-t-[8px] border-t-transparent border-l-[10px] md:border-l-[14px] border-l-orange-500 border-b-[6px] md:border-b-[8px] border-b-transparent absolute right-0 top-1/2 -translate-y-1/2" />
    </div>
  </motion.div>
);

const DashboardCard = ({ status }: { status: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 40 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6 }}
    className="relative max-w-lg w-full"
  >
    <div className="absolute -inset-1 bg-orange-500 rounded-2xl opacity-15 md:opacity-25 blur-lg md:blur-xl" />

    <div className="relative bg-zinc-900/95 backdrop-blur-2xl rounded-2xl p-4 md:p-8 shadow-2xl border border-white/20">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-6 h-6 md:w-7 md:h-7 flex items-center justify-center">
            <Bot className="w-6 h-6 md:w-7 md:h-7 text-orange-400" />
          </div>
          <h3 className="text-base md:text-xl font-bold text-white">Email Summary Agent</h3>
        </div>
        <div
          className={`px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-bold backdrop-blur-sm flex items-center gap-2 ${
            status === 'running'
              ? 'bg-orange-500/30 text-orange-200 border-2 border-orange-400/50'
              : 'bg-green-500/30 text-green-200 border-2 border-green-400/50'
          }`}
        >
          {status === 'running' ? (
            <>
              <Zap className="w-4 h-4" />
              <span>Running...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Completed</span>
            </>
          )}
        </div>
      </div>

      {status === 'running' && (
        <div className="mb-4 md:mb-6">
          <div className="w-full h-2 md:h-2.5 bg-zinc-700/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 3, ease: "easeInOut" }}
              className="h-full bg-orange-500"
            />
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {status === 'completed' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className="relative bg-zinc-800/60 backdrop-blur-sm rounded-xl p-4 md:p-6 border border-green-500/30">
              <div className="flex items-center gap-2 mb-4">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.5, delay: 0.6, type: "spring" }}
                >
                  <BarChart3 className="w-7 h-7 text-green-400" />
                </motion.div>
                <p className="text-lg text-green-300 font-bold">Output</p>
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, staggerChildren: 0.1 }}
              >
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-slate-300 leading-relaxed mb-1 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span>5 emails summarized</span>
                </motion.div>
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 1.0 }}
                  className="text-slate-300 leading-relaxed mb-1 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span>2 action items sent to Slack</span>
                </motion.div>
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 1.1 }}
                  className="text-slate-300 leading-relaxed flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span>Team notified successfully</span>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </motion.div>
);

const TypingPrompt = ({ text }: { text: string }) => {
  const [displayText, setDisplayText] = useState('');

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index <= text.length) {
        setDisplayText(text.slice(0, index));
        index++;
      } else {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative max-w-3xl w-full"
    >
      <div className="absolute -inset-1 bg-orange-500 rounded-xl md:rounded-2xl opacity-15 md:opacity-25 blur-lg md:blur-xl"></div>

      <div className="relative bg-zinc-900/90 backdrop-blur-xl rounded-xl md:rounded-2xl p-4 md:p-8 shadow-xl md:shadow-2xl border border-white/10">
        <div className="flex items-center gap-1.5 md:gap-2 mb-4 md:mb-6">
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-gradient-to-br from-red-400 to-red-600 rounded-full"></div>
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full"></div>
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-gradient-to-br from-green-400 to-green-600 rounded-full"></div>
          <div className="ml-auto text-xs text-slate-500 font-mono hidden sm:block">prompt.ai</div>
        </div>

        <div className="bg-zinc-800/80 rounded-lg md:rounded-xl p-3 md:p-6 min-h-[80px] md:min-h-[100px] flex items-center border border-white/5">
          <p className="relative text-white font-mono text-sm md:text-base lg:text-lg leading-relaxed break-words">
            {displayText}
            <span className="inline-block w-0.5 h-4 md:h-6 bg-orange-400 ml-1 rounded-full animate-pulse"></span>
          </p>
        </div>
      </div>
    </motion.div>
  );
};

const HeroAnimation = () => {
  const [step, setStep] = useState('typing');
  const [dashboardStatus, setDashboardStatus] = useState('running');
  const [isPaused, setIsPaused] = useState(false);

  const TIMINGS = {
    typing: 5000,
    building: 8000,  // Increased from 4500 to 8000 for all animations to complete
    connecting: 4000,
    dashboard: 6000,
    tagline: 4500,
  };

  const steps = ['typing', 'building', 'connecting', 'dashboard', 'tagline'];

  useEffect(() => {
    if (isPaused) return;

    let timeout;

    switch (step) {
      case 'typing':
        timeout = setTimeout(() => setStep('building'), TIMINGS.typing);
        break;
      case 'building':
        timeout = setTimeout(() => setStep('connecting'), TIMINGS.building);
        break;
      case 'connecting':
        timeout = setTimeout(() => {
          setStep('dashboard');
          setDashboardStatus('running');
        }, TIMINGS.connecting);
        break;
      case 'dashboard':
        timeout = setTimeout(() => {
          setDashboardStatus('completed');
        }, 2000);

        const taglineTimeout = setTimeout(() => {
          setStep('tagline');
        }, TIMINGS.dashboard);

        return () => {
          clearTimeout(timeout);
          clearTimeout(taglineTimeout);
        };
      case 'tagline':
        timeout = setTimeout(() => {
          setStep('typing');
        }, TIMINGS.tagline);
        break;
    }

    return () => clearTimeout(timeout);
  }, [step, isPaused]);

  return (
    <div className="flex flex-col items-center">
      <div className="min-h-[300px] md:min-h-[400px] flex items-center justify-center p-2 md:p-4 w-full">
        <div className="relative z-10 w-full max-w-6xl mx-auto">
          <AnimatePresence mode="wait">
          {step === 'typing' && (
            <motion.div
              key="typing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center gap-4 md:gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xl md:text-3xl text-transparent bg-clip-text bg-gradient-to-r from-slate-300 to-slate-500 font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3"
              >
                <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-orange-400" />
                Create Your Agent
              </motion.h2>
              <TypingPrompt text="Summarize my last 10 emails and send to Slack." />
            </motion.div>
          )}

          {step === 'building' && (
            <motion.div
              key="building"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center gap-4 md:gap-8 w-full max-w-3xl mx-auto"
            >
              <motion.h2
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xl md:text-3xl text-orange-400 font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3 text-center"
              >
                <motion.div
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                >
                  <Settings className="w-6 h-6 md:w-8 md:h-8 text-orange-400 flex-shrink-0" />
                </motion.div>
                Building Your Workflow
              </motion.h2>

              {/* Workflow Builder Visualization - Compact Modern Design */}
              <div className="relative max-w-3xl w-full">
                <div className="absolute -inset-1 bg-orange-500 rounded-xl md:rounded-2xl opacity-15 md:opacity-25 blur-lg md:blur-xl"></div>
                <div className="relative bg-zinc-900/95 backdrop-blur-2xl rounded-xl md:rounded-2xl p-4 md:p-6 border border-white/20 shadow-xl md:shadow-2xl">
                <div className="relative">
                  {/* Building Steps - Compact grid layout */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 md:gap-3">
                    {[
                      { icon: <FileSearch className="w-5 h-5 md:w-6 md:h-6 text-orange-400" />, text: 'Analyzing prompt', delay: 0 },
                      { icon: <Link className="w-5 h-5 md:w-6 md:h-6 text-amber-400" />, text: 'Detecting plugins', delay: 0.3 },
                      { icon: <Settings className="w-5 h-5 md:w-6 md:h-6 text-orange-400" />, text: 'Building logic', delay: 0.6 },
                      { icon: <BarChart3 className="w-5 h-5 md:w-6 md:h-6 text-green-400" />, text: 'Creating schemas', delay: 0.9 }
                    ].map((step, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: step.delay, duration: 0.4 }}
                        className="flex items-center gap-2.5 bg-zinc-800/50 rounded-lg p-2.5 md:p-3 border border-white/5 relative overflow-hidden"
                      >
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            delay: step.delay,
                            duration: 0.3,
                            type: "spring",
                            stiffness: 200
                          }}
                          className="flex-shrink-0 w-6 h-6 md:w-7 md:h-7 flex items-center justify-center"
                        >
                          {step.icon}
                        </motion.div>
                        <p className="text-white font-medium text-xs md:text-sm flex-1">{step.text}</p>
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            delay: step.delay + 0.6,
                            type: "spring",
                            stiffness: 200
                          }}
                          className="flex-shrink-0 w-6 h-6 md:w-7 md:h-7 bg-green-500 rounded-full flex items-center justify-center"
                        >
                          <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-white" />
                        </motion.div>
                        {/* Progress bar */}
                        <motion.div
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ delay: step.delay + 0.2, duration: 0.6 }}
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 origin-left"
                        />
                      </motion.div>
                    ))}
                  </div>

                  {/* Final Workflow Preview - Compact */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.5, duration: 0.4 }}
                    className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-orange-500/30"
                  >
                    <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5 md:gap-2 bg-zinc-800/50 px-2.5 md:px-3 py-1.5 md:py-2 rounded-md border border-white/5">
                        <PluginIcon pluginId="google-mail" className="w-4 h-4 md:w-5 md:h-5 text-red-500" alt="Gmail" />
                        <span className="text-white font-medium text-xs md:text-sm">Gmail</span>
                      </div>
                      <motion.div
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="text-orange-400 text-sm md:text-base"
                      >
                        →
                      </motion.div>
                      <div className="flex items-center gap-1.5 md:gap-2 bg-zinc-800/50 px-2.5 md:px-3 py-1.5 md:py-2 rounded-md border border-white/5">
                        <Brain className="w-4 h-4 md:w-5 md:h-5 text-amber-500" />
                        <span className="text-white font-medium text-xs md:text-sm">AI Agent</span>
                      </div>
                      <motion.div
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                        className="text-amber-400 text-sm md:text-base"
                      >
                        →
                      </motion.div>
                      <div className="flex items-center gap-1.5 md:gap-2 bg-zinc-800/50 px-2.5 md:px-3 py-1.5 md:py-2 rounded-md border border-white/5">
                        <PluginIcon pluginId="slack" className="w-4 h-4 md:w-5 md:h-5 text-[#4A154B]" alt="Slack" />
                        <span className="text-white font-medium text-xs md:text-sm">Slack</span>
                      </div>
                    </div>
                  </motion.div>
                </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'connecting' && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center gap-4 md:gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xl md:text-3xl text-orange-400 font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3 text-center"
              >
                <Zap className="w-6 h-6 md:w-8 md:h-8 text-orange-400 flex-shrink-0" />
                Connecting Plugins
              </motion.h2>

              {/* Vertical connection visualization with checkmarks */}
              <div className="relative max-w-3xl w-full">
                <div className="absolute -inset-1 bg-orange-500 rounded-xl md:rounded-2xl opacity-15 md:opacity-25 blur-lg md:blur-xl"></div>
                <div className="relative bg-zinc-900/95 backdrop-blur-2xl rounded-xl md:rounded-2xl p-4 md:p-6 border border-white/20 shadow-xl md:shadow-2xl">
                <div className="relative space-y-2.5 md:space-y-3">
                  {[
                    { type: 'mail', label: 'Gmail', delay: 0 },
                    { type: 'brain', label: 'AI Agent', delay: 0.2 },
                    { type: 'slack', label: 'Slack', delay: 0.4 }
                  ].map((item, index) => (
                    <motion.div
                      key={item.type}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: item.delay, duration: 0.5 }}
                      className="flex items-center gap-2.5 bg-zinc-800 rounded-lg md:rounded-xl p-2.5 md:p-3 border border-white/10 relative z-10"
                    >
                      <div className="w-6 h-6 md:w-7 md:h-7 flex items-center justify-center flex-shrink-0">
                        {item.type === 'mail' && <PluginIcon pluginId="google-mail" className="w-5 h-5 md:w-6 md:h-6 text-red-500" alt="Gmail" />}
                        {item.type === 'brain' && <Brain className="w-5 h-5 md:w-6 md:h-6 text-purple-500" />}
                        {item.type === 'slack' && <PluginIcon pluginId="slack" className="w-5 h-5 md:w-6 md:h-6 text-[#4A154B]" alt="Slack" />}
                      </div>

                      <div className="flex-1">
                        <p className="text-white font-bold text-xs md:text-sm">{item.label}</p>
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: item.delay + 0.3 }}
                          className="text-orange-400 text-xs font-medium"
                        >
                          Authenticating...
                        </motion.p>
                      </div>

                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: item.delay + 0.6, type: "spring", stiffness: 200 }}
                        className="w-6 h-6 md:w-7 md:h-7 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0"
                      >
                        <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-white" />
                      </motion.div>
                    </motion.div>
                  ))}

                  {/* Success message */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.2, duration: 0.5 }}
                    className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-orange-500/30 text-center"
                  >
                    <p className="text-orange-400 font-bold text-xs md:text-sm">All plugins connected successfully!</p>
                  </motion.div>
                </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="flex flex-col items-center gap-4 md:gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xl md:text-3xl text-orange-400 font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3"
              >
                <Bot className="w-6 h-6 md:w-8 md:h-8 text-orange-400" />
                Your Agent Dashboard
              </motion.h2>
              <DashboardCard status={dashboardStatus} />
            </motion.div>
          )}

          {step === 'tagline' && (
            <motion.div
              key="tagline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="flex items-center justify-center min-h-[400px]"
            >
              <motion.div
                initial={{ opacity: 0, y: 40, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 1.2, type: "spring" }}
                className="text-center relative"
              >
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.3, 0.6, 0.3]
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute inset-0 bg-orange-500/30 blur-3xl"
                />

                <motion.h2
                  initial={{ backgroundPosition: '0% 50%' }}
                  animate={{
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                  className="relative text-3xl md:text-4xl lg:text-5xl font-black text-orange-400 mb-4 drop-shadow-2xl"
                >
                  Your Personal AI Workforce
                </motion.h2>
                
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5, duration: 0.8 }}
                >
                  <p className="text-2xl md:text-3xl text-slate-300 font-bold flex items-center justify-center gap-3">
                    Ready in Minutes
                    <motion.div
                      animate={{
                        rotate: [0, 10, -10, 0],
                        scale: [1, 1.2, 1]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    >
                      <CheckCircle className="w-8 h-8 text-green-400" />
                    </motion.div>
                  </p>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      {/* Animation Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="w-full px-4 md:px-8 mt-4 md:mt-6"
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center gap-8 md:gap-20 w-full">
            {/* Play/Pause Button */}
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="group relative flex items-center justify-center w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-md transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-orange-500/50"
              aria-label={isPaused ? 'Play animation' : 'Pause animation'}
            >
              {isPaused ? (
                <Play className="w-4 h-4 md:w-5 md:h-5 text-white ml-0.5" />
              ) : (
                <Pause className="w-4 h-4 md:w-5 md:h-5 text-white" />
              )}
            </button>

            {/* Step Indicators */}
            <div className="flex items-center gap-4 md:gap-10">
              {steps.map((stepName, index) => {
                const isActive = step === stepName;
                const stepLabels = {
                  typing: 'Create',
                  building: 'Build',
                  connecting: 'Connect',
                  dashboard: 'Dashboard',
                  tagline: 'Launch'
                };

                return (
                  <button
                    key={stepName}
                    onClick={() => {
                      setStep(stepName);
                      if (stepName === 'dashboard') {
                        setDashboardStatus('running');
                      }
                    }}
                    className="group relative flex flex-col items-center gap-1.5"
                    aria-label={`Go to step ${index + 1}: ${stepLabels[stepName]}`}
                  >
                    {/* Step dot */}
                    <div
                      className={`relative w-2.5 h-2.5 md:w-3 md:h-3 rounded-full transition-all duration-300 ${
                        isActive
                          ? 'bg-orange-400 shadow-lg shadow-orange-500/50 scale-125'
                          : 'bg-zinc-600 hover:bg-zinc-500 hover:scale-110'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeStepIndicator"
                          className="absolute -inset-1 bg-orange-400/30 rounded-full blur-sm"
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                    </div>

                    {/* Step label */}
                    <span
                      className={`text-[10px] md:text-xs font-medium transition-all duration-300 whitespace-nowrap ${
                        isActive ? 'text-orange-400' : 'text-zinc-500 group-hover:text-zinc-400'
                      }`}
                    >
                      {stepLabels[stepName]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// ============================================================================
// LANDING PAGE COMPONENTS
// ============================================================================

export default function AgentPilotLanding() {
  const [email, setEmail] = useState('');

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

      {/* AI Intelligence Hero Banner - Full Width Top Section */}
      <section className="relative z-10 w-full overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 lg:px-6 py-12 md:py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left: Text Content */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="space-y-8"
            >
              {/* Main heading */}
              <div className="space-y-4">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                >
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black leading-tight">
                    <span className="text-orange-400">Your Personal</span>
                    <br />
                    <span className="text-white">AI Workforce</span>
                  </h1>
                </motion.div>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.4 }}
                  className="text-xl md:text-2xl text-slate-300 font-medium"
                >
                  Build AI agents that run your daily work automatically
                </motion.p>
              </div>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="text-base md:text-lg text-slate-400 leading-relaxed"
              >
                Transform your workflows with AI agents that understand, learn, and execute complex tasks across your favorite tools—no coding required.
              </motion.p>

              {/* CTA Buttons */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex flex-col sm:flex-row gap-4"
              >
                <a href="/signup" className="inline-block">
                  <button className="group relative px-8 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl shadow-lg hover:shadow-orange-500/50 transition-all duration-300 hover:scale-105 overflow-hidden w-full sm:w-auto">
                    <span className="relative flex items-center justify-center gap-2">
                      Get Started Free
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </button>
                </a>
                <a href="#how-it-works" className="inline-block">
                  <button className="px-8 py-4 bg-white/5 backdrop-blur-sm text-white font-semibold rounded-xl border-2 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 w-full sm:w-auto">
                    Watch Demo
                  </button>
                </a>
              </motion.div>

              {/* Trust indicators */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.7 }}
                className="flex flex-wrap items-center gap-6 text-sm text-slate-400"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>Free forever plan</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>No credit card</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>2-min setup</span>
                </div>
              </motion.div>
            </motion.div>

            {/* Right: Stunning Workflow Visualization */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="relative hidden lg:flex items-center justify-center"
            >
              <div className="relative w-full h-[500px] flex items-center justify-center">
                {/* Main workflow window */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.6, delay: 0.6 }}
                  className="relative bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-2xl rounded-2xl border border-white/20 shadow-2xl overflow-hidden w-[480px] h-[420px]"
                >
                  {/* Header */}
                  <div className="border-b border-white/10 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center"
                        animate={{ boxShadow: ['0 0 0px rgba(249,115,22,0.5)', '0 0 20px rgba(249,115,22,0.8)', '0 0 0px rgba(249,115,22,0.5)'] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Workflow className="w-5 h-5 text-white" />
                      </motion.div>
                      <div>
                        <div className="text-sm font-bold text-white">Lead Qualification Flow</div>
                        <div className="text-xs text-slate-400">Powered by AI Pilot</div>
                      </div>
                    </div>
                    <motion.div
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 border border-green-500/30"
                      animate={{ opacity: [0.7, 1, 0.7] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-xs text-green-300 font-medium">Active</span>
                    </motion.div>
                  </div>

                  {/* Workflow steps */}
                  <div className="p-6 space-y-4">
                    {[
                      { icon: Mail, label: 'New lead from form', color: '#3b82f6', plugin: 'Email', delay: 0.8 },
                      { icon: Brain, label: 'AI analyzes lead quality', color: '#8b5cf6', plugin: 'AI Model', delay: 1.2 },
                      { icon: Database, label: 'Update CRM record', color: '#10b981', plugin: 'HubSpot', delay: 1.6 },
                      { icon: MessageSquare, label: 'Send to sales team', color: '#f59e0b', plugin: 'Slack', delay: 2.0 }
                    ].map((step, idx) => {
                      const StepIcon = step.icon;
                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.5, delay: step.delay }}
                          className="relative"
                        >
                          <div className="flex items-center gap-4">
                            {/* Step number and icon */}
                            <div className="relative flex-shrink-0">
                              <motion.div
                                className="w-12 h-12 rounded-xl flex items-center justify-center relative z-10"
                                style={{ background: `${step.color}20`, border: `2px solid ${step.color}` }}
                                animate={{ scale: [1, 1.05, 1] }}
                                transition={{ duration: 2, repeat: Infinity, delay: step.delay + 0.5 }}
                              >
                                <StepIcon className="w-5 h-5" style={{ color: step.color }} />
                              </motion.div>
                              {idx < 3 && (
                                <motion.div
                                  className="absolute left-1/2 top-full w-0.5 h-4 -ml-px"
                                  style={{ background: step.color, opacity: 0.3 }}
                                  initial={{ scaleY: 0 }}
                                  animate={{ scaleY: 1 }}
                                  transition={{ duration: 0.3, delay: step.delay + 0.3 }}
                                />
                              )}
                            </div>

                            {/* Step content */}
                            <div className="flex-1 bg-zinc-800/50 rounded-xl p-3 border border-white/5">
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-sm font-medium text-white">{step.label}</div>
                                <motion.div
                                  className="px-2 py-0.5 rounded text-[10px] font-semibold"
                                  style={{ background: `${step.color}30`, color: step.color }}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.3, delay: step.delay + 0.2 }}
                                >
                                  {step.plugin}
                                </motion.div>
                              </div>
                              <motion.div
                                className="h-1 rounded-full bg-white/10 overflow-hidden"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: step.delay + 0.4 }}
                              >
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ background: step.color }}
                                  initial={{ width: '0%' }}
                                  animate={{ width: '100%' }}
                                  transition={{ duration: 1, delay: step.delay + 0.5, ease: "easeOut" }}
                                />
                              </motion.div>
                            </div>
                          </div>

                          {/* Animated data flow particles */}
                          <motion.div
                            className="absolute left-6 top-12 w-1 h-1 rounded-full"
                            style={{ background: step.color }}
                            initial={{ opacity: 0 }}
                            animate={{
                              y: [0, 16, 32],
                              opacity: [0, 1, 0],
                              scale: [0, 1.5, 0]
                            }}
                            transition={{
                              duration: 1.5,
                              repeat: Infinity,
                              delay: step.delay + 1,
                              repeatDelay: 2
                            }}
                          />
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Decorative elements */}
                  <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="absolute w-32 h-32 rounded-full"
                        style={{
                          background: `radial-gradient(circle, ${['rgba(249,115,22,0.15)', 'rgba(139,92,246,0.1)', 'rgba(59,130,246,0.1)'][i]} 0%, transparent 70%)`,
                          left: `${20 + i * 30}%`,
                          top: `${10 + i * 25}%`
                        }}
                        animate={{
                          scale: [1, 1.3, 1],
                          opacity: [0.3, 0.6, 0.3],
                          x: [0, 20, 0],
                          y: [0, -10, 0]
                        }}
                        transition={{
                          duration: 4 + i,
                          repeat: Infinity,
                          delay: i * 0.5
                        }}
                      />
                    ))}
                  </div>
                </motion.div>

                {/* Floating plugin badges */}
                {[
                  { icon: MessageSquare, name: 'Slack', x: -30, y: -20, color: '#e01e5a', delay: 2.4 },
                  { icon: Database, name: 'HubSpot', x: 490, y: 60, color: '#ff7a59', delay: 2.6 },
                  { icon: Mail, name: 'Gmail', x: -40, y: 380, color: '#ea4335', delay: 2.8 },
                  { icon: Calendar, name: 'Calendar', x: 490, y: 350, color: '#4285f4', delay: 3.0 }
                ].map((plugin, i) => {
                  const PluginIcon = plugin.icon;
                  return (
                    <motion.div
                      key={i}
                      className="absolute flex items-center gap-2 px-3 py-2 rounded-xl backdrop-blur-xl border shadow-lg"
                      style={{
                        left: plugin.x,
                        top: plugin.y,
                        background: 'rgba(24, 24, 27, 0.8)',
                        borderColor: `${plugin.color}40`
                      }}
                      initial={{ opacity: 0, scale: 0, rotate: -10 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      transition={{ duration: 0.5, delay: plugin.delay, type: "spring" }}
                      whileHover={{ scale: 1.1, rotate: 2 }}
                    >
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${plugin.color}20` }}>
                        <PluginIcon className="w-3.5 h-3.5" style={{ color: plugin.color }} />
                      </div>
                      <span className="text-xs font-medium text-white">{plugin.name}</span>
                      <motion.div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#10b981' }}
                        animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    </motion.div>
                  );
                })}

                {/* Background glow */}
                <motion.div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-3xl -z-10"
                  style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.2) 0%, transparent 70%)' }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 4, repeat: Infinity }}
                />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Interactive Feature Demo */}
      <section className="py-6 md:py-8 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-8"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
              <span className="text-orange-400">See It In Action</span>
            </h2>
            <p className="text-base text-gray-200">From natural language to automated workflow in seconds</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-2xl overflow-hidden relative">
              {/* Animated background particles */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[...Array(6)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      x: [0, 100, 0],
                      y: [0, -50, 0],
                      opacity: [0.2, 0.5, 0.2],
                      scale: [1, 1.5, 1],
                    }}
                    transition={{
                      duration: 4 + i * 0.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.8
                    }}
                    className="absolute w-2 h-2 rounded-full bg-orange-400 blur-sm"
                    style={{
                      left: `${20 + i * 12}%`,
                      top: `${10 + i * 15}%`,
                    }}
                  />
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
                <div className="space-y-6">
                  <motion.h3
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="text-2xl font-bold text-white"
                  >
                    Natural Language to Automation
                  </motion.h3>

                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                    className="bg-zinc-800/50 rounded-xl p-6 border border-orange-500/30 relative overflow-hidden"
                  >
                    {/* Animated border glow */}
                    <motion.div
                      animate={{
                        opacity: [0.5, 1, 0.5],
                        scale: [1, 1.02, 1],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="absolute inset-0 bg-orange-500/20 rounded-xl"
                    />

                    <div className="relative">
                      <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: 0.6 }}
                        className="text-sm text-gray-300 mb-2"
                      >
                        Input:
                      </motion.div>

                      <div className="bg-zinc-800/30 rounded-lg p-4 border border-orange-400/30 mb-4 relative">
                        {/* Typing animation */}
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: "100%" }}
                          viewport={{ once: true }}
                          transition={{ duration: 2, delay: 0.8 }}
                          className="absolute top-0 left-0 h-full bg-gradient-to-r from-transparent via-orange-400/10 to-transparent"
                        />

                        <motion.p
                          initial={{ opacity: 0 }}
                          whileInView={{ opacity: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6, delay: 1.2 }}
                          className="text-gray-200 italic relative z-10"
                        >
                          "Send me a Slack notification whenever a high-value lead completes our pricing calculator,
                          and automatically add them to our VIP nurture sequence in HubSpot."
                        </motion.p>

                        {/* Cursor animation */}
                        <motion.span
                          animate={{ opacity: [1, 0, 1] }}
                          transition={{ duration: 0.8, repeat: Infinity }}
                          className="inline-block w-0.5 h-4 bg-orange-400 ml-1"
                        />
                      </div>

                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, delay: 1.6 }}
                        className="text-sm text-gray-300 mb-2"
                      >
                        AI Analysis:
                      </motion.div>

                      <div className="space-y-2">
                        {[
                          { text: "Trigger: Pricing calculator completion", color: "bg-orange-400", delay: 1.8 },
                          { text: "Condition: High-value lead classification", color: "bg-orange-500", delay: 2.0 },
                          { text: "Actions: Slack notification + HubSpot automation", color: "bg-orange-600", delay: 2.2 }
                        ].map((item, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -20 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.4, delay: item.delay }}
                            className="flex items-center text-sm"
                          >
                            <motion.div
                              initial={{ scale: 0 }}
                              whileInView={{ scale: 1 }}
                              viewport={{ once: true }}
                              transition={{ duration: 0.3, delay: item.delay + 0.2, type: "spring" }}
                              className={`w-2 h-2 ${item.color} rounded-full mr-3`}
                            />
                            <span className="text-gray-200">{item.text}</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </div>

                <div className="space-y-6">
                  <motion.h3
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                    className="text-2xl font-bold text-white"
                  >
                    Generated Workflow
                  </motion.h3>

                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.5 }}
                    className="bg-gradient-to-br from-zinc-900/50 to-zinc-800/50 rounded-xl p-6 border border-orange-400/30 relative overflow-hidden"
                  >
                    {/* Animated flow lines */}
                    <motion.div
                      initial={{ pathLength: 0 }}
                      whileInView={{ pathLength: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 2, delay: 2.5 }}
                      className="absolute inset-0"
                    >
                      <svg className="w-full h-full" viewBox="0 0 300 200">
                        <motion.path
                          d="M 50 60 Q 150 80 250 120"
                          stroke="url(#gradient)"
                          strokeWidth="2"
                          fill="none"
                          initial={{ pathLength: 0 }}
                          whileInView={{ pathLength: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 2, delay: 2.5 }}
                        />
                        <defs>
                          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#fb923c" stopOpacity="0.6" />
                            <stop offset="50%" stopColor="#f97316" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#ea580c" stopOpacity="0.6" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </motion.div>

                    <div className="space-y-4 relative z-10">
                      {[
                        {
                          step: "1",
                          title: "Monitor Pricing Calculator",
                          subtitle: "Webhook listener active",
                          color: "bg-orange-500",
                          delay: 2.6
                        },
                        {
                          step: "2",
                          title: "Evaluate Lead Score",
                          subtitle: "AI classification: High-value criteria",
                          color: "bg-orange-500",
                          delay: 2.8
                        },
                        {
                          step: "3",
                          title: "Execute Actions",
                          subtitle: "Slack + HubSpot integration",
                          color: "bg-orange-500",
                          delay: 3.0
                        }
                      ].map((step, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, x: 30 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.5, delay: step.delay }}
                          className="flex items-center space-x-3"
                        >
                          <motion.div
                            initial={{ scale: 0, rotate: -180 }}
                            whileInView={{ scale: 1, rotate: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.4, delay: step.delay + 0.2, type: "spring" }}
                            className={`w-8 h-8 ${step.color} rounded-full flex items-center justify-center text-white text-sm font-bold relative`}
                          >
                            {step.step}
                            {/* Pulsing ring */}
                            <motion.div
                              animate={{
                                scale: [1, 1.5, 1],
                                opacity: [0.7, 0, 0.7],
                              }}
                              transition={{
                                duration: 2,
                                repeat: Infinity,
                                delay: step.delay + 0.5
                              }}
                              className={`absolute inset-0 ${step.color} rounded-full`}
                            />
                          </motion.div>
                          <div>
                            <motion.div
                              initial={{ opacity: 0 }}
                              whileInView={{ opacity: 1 }}
                              viewport={{ once: true }}
                              transition={{ duration: 0.4, delay: step.delay + 0.3 }}
                              className="font-medium text-white"
                            >
                              {step.title}
                            </motion.div>
                            <motion.div
                              initial={{ opacity: 0 }}
                              whileInView={{ opacity: 1 }}
                              viewport={{ once: true }}
                              transition={{ duration: 0.4, delay: step.delay + 0.4 }}
                              className="text-sm text-gray-300"
                            >
                              {step.subtitle}
                            </motion.div>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Progress bar */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.5, delay: 3.2 }}
                      className="mt-6"
                    >
                      <div className="w-full bg-zinc-700/50 rounded-full h-2 overflow-hidden">
                        <motion.div
                          initial={{ width: "0%" }}
                          whileInView={{ width: "100%" }}
                          viewport={{ once: true }}
                          transition={{ duration: 1.5, delay: 3.4, ease: "easeInOut" }}
                          className="h-full bg-orange-500 relative"
                        >
                          {/* Moving shine effect */}
                          <motion.div
                            animate={{ x: [-100, 200] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute inset-0 w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
                          />
                        </motion.div>
                      </div>
                    </motion.div>

                    {/* Success message with confetti effect */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.5, delay: 4.5, type: "spring" }}
                      className="mt-6 p-3 bg-green-900/30 rounded-lg border border-green-500/30 relative overflow-hidden"
                    >
                      {/* Confetti particles */}
                      {[...Array(8)].map((_, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, scale: 0, y: 0 }}
                          whileInView={{
                            opacity: [0, 1, 0],
                            scale: [0, 1, 0.5],
                            y: [0, -30, -60],
                            x: [0, (Math.random() - 0.5) * 60],
                            rotate: [0, Math.random() * 360]
                          }}
                          viewport={{ once: true }}
                          transition={{
                            duration: 1.2,
                            delay: 4.6 + i * 0.1,
                            ease: "easeOut"
                          }}
                          className={`absolute w-2 h-2 ${
                            i % 3 === 0 ? 'bg-green-400' : i % 3 === 1 ? 'bg-yellow-400' : 'bg-blue-400'
                          } rounded-full`}
                          style={{
                            left: `${20 + i * 8}%`,
                            top: '50%'
                          }}
                        />
                      ))}

                      <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: 4.7 }}
                        className="text-sm text-green-300 font-medium relative z-10 flex items-center gap-2"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Workflow deployed and active
                      </motion.div>
                    </motion.div>
                  </motion.div>
                </div>
              </div>

              {/* Data flow animation */}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1, delay: 5 }}
                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              >
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      scale: [0, 1.5, 0],
                      opacity: [0, 0.6, 0],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: i * 0.7 + 5,
                      ease: "easeInOut"
                    }}
                    className="absolute w-4 h-4 bg-orange-400 rounded-full"
                  />
                ))}
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Mission Statement */}
      <section className="relative z-10 py-16">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black mb-3 text-orange-400">
              Why We Built AgentPilot
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-gradient-to-br from-zinc-900/95 to-zinc-800/95 backdrop-blur-2xl rounded-3xl p-12 md:p-16 border border-white/20">
              <div className="space-y-6 text-slate-300 max-w-4xl mx-auto text-center">
                <p className="text-xl leading-relaxed">
                  AgentPilot was born from a simple frustration: watching brilliant professionals
                  waste hours on repetitive digital tasks that should be automated.
                </p>
                <p className="text-xl leading-relaxed">
                  We experienced firsthand how existing automation tools failed
                  non-technical users. AgentPilot represents a fundamental shift in how we think about AI and work.
                </p>
                <p className="text-xl leading-relaxed">
                  We believe the future isn't about replacing humans with AI — it's about giving
                  every professional their own intelligent pilot to handle the mundane,
                  so they can focus on what truly matters.
                </p>
                <p className="text-xl leading-relaxed">
                  Every design decision prioritizes simplicity, trust, and human empowerment.
                  Because AI should make work more human, not less.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="relative z-10 py-16">
        <div className="max-w-7xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-3">
              <span className="text-orange-400">
                How It Works
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              From prompt to production in three simple steps
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Describe Your Goal",
                description: "Tell AgentPilot what you want in plain English. No technical knowledge required.",
                icon: <MessageSquare className="w-12 h-12 text-orange-400" />,
                color: "orange"
              },
              {
                step: "02",
                title: "AI Builds Your Agent",
                description: "Our AI automatically creates the workflow, connects the right tools, and configures everything.",
                icon: <Sparkles className="w-12 h-12 text-amber-400" />,
                color: "amber"
              },
              {
                step: "03",
                title: "Connect & Run",
                description: "Authorize your tools once with OAuth, then run on demand or schedule automatically.",
                icon: <Zap className="w-12 h-12 text-orange-400" />,
                color: "orange"
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className="relative group"
              >
                <div className="absolute -inset-0.5 bg-orange-500 rounded-xl opacity-0 group-hover:opacity-30 blur-lg transition duration-500" />
                <div className="relative bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10 h-full">
                  <div className="mb-4">{item.icon}</div>
                  <div className="text-xs font-bold text-slate-500 mb-2">STEP {item.step}</div>
                  <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Plugin Integrations */}
      <section className="relative z-10 py-12 border-y border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-slate-400 mb-8">Works with your favorite tools</p>
          <div className="flex flex-wrap items-center justify-center gap-12 opacity-70">
            {/* Gmail */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="google-mail" className="w-8 h-8 text-red-500" alt="Gmail" />
              <span className="text-slate-300 font-medium">Gmail</span>
            </div>

            {/* Slack */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="slack" className="w-8 h-8 text-[#4A154B]" alt="Slack" />
              <span className="text-slate-300 font-medium">Slack</span>
            </div>

            {/* Google Drive */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="google-drive" className="w-8 h-8 text-[#4285F4]" alt="Google Drive" />
              <span className="text-slate-300 font-medium">Google Drive</span>
            </div>

            {/* Google Calendar */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="google-calendar" className="w-8 h-8 text-[#4285F4]" alt="Google Calendar" />
              <span className="text-slate-300 font-medium">Calendar</span>
            </div>

            {/* HubSpot */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="hubspot" className="w-8 h-8 text-[#FF7A59]" alt="HubSpot" />
              <span className="text-slate-300 font-medium">HubSpot</span>
            </div>

            {/* Google Ads */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="google-ads" className="w-8 h-8 text-[#4285F4]" alt="Google Ads" />
              <span className="text-slate-300 font-medium">Google Ads</span>
            </div>

            {/* Meta Ads */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="meta-ads" className="w-8 h-8 text-[#0081FB]" alt="Meta Ads" />
              <span className="text-slate-300 font-medium">Meta Ads</span>
            </div>

            {/* Facebook */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="facebook" className="w-8 h-8 text-[#1877F2]" alt="Facebook" />
              <span className="text-slate-300 font-medium">Facebook</span>
            </div>

            {/* Instagram */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <PluginIcon pluginId="instagram" className="w-8 h-8 text-[#E4405F]" alt="Instagram" />
              <span className="text-slate-300 font-medium">Instagram</span>
            </div>

            {/* And more indicator */}
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-2xl">+</span>
              <span className="text-sm font-medium">20 more</span>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="relative z-10 py-16">
        <div className="max-w-7xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-3">
              <span className="text-orange-400">
                Cross-Functional Use Cases
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Automate critical business workflows across departments
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: <Headphones className="w-8 h-8 text-orange-400" />,
                title: "Customer Support Automation",
                description: "Automate ticket analysis, categorization, and routing. Generate responses and send follow-ups via email or WhatsApp.",
                gradient: "from-orange-500/20 to-amber-500/20"
              },
              {
                icon: <Receipt className="w-8 h-8 text-green-400" />,
                title: "Invoice & Expense Processing",
                description: "Extract invoice data, automate validation and reconciliation. Send payment reminders and generate financial reports.",
                gradient: "from-green-500/20 to-emerald-500/20"
              },
              {
                icon: <ShoppingCart className="w-8 h-8 text-blue-400" />,
                title: "Sales Order Processing",
                description: "Automate order intake and validation. Analyze stock availability and send order confirmations automatically.",
                gradient: "from-blue-500/20 to-cyan-500/20"
              },
              {
                icon: <Users className="w-8 h-8 text-purple-400" />,
                title: "HR & Recruitment Workflows",
                description: "Analyze candidate data, automate interview scheduling, and generate onboarding documentation automatically.",
                gradient: "from-purple-500/20 to-pink-500/20"
              },
              {
                icon: <Package className="w-8 h-8 text-amber-400" />,
                title: "Inventory Management",
                description: "Process inventory data, predict shortages, and send automatic restock alerts to suppliers and teams.",
                gradient: "from-amber-500/20 to-yellow-500/20"
              },
              {
                icon: <Shield className="w-8 h-8 text-red-400" />,
                title: "Compliance & Reporting",
                description: "Collect compliance data, generate regulatory reports, and distribute to stakeholders automatically.",
                gradient: "from-red-500/20 to-rose-500/20"
              },
              {
                icon: <MessageCircle className="w-8 h-8 text-teal-400" />,
                title: "Survey Data Analysis",
                description: "Process survey results, extract insights, and send personalized follow-up messages automatically.",
                gradient: "from-teal-500/20 to-cyan-500/20"
              },
              {
                icon: <CalendarClock className="w-8 h-8 text-indigo-400" />,
                title: "Appointment Scheduling",
                description: "Automate appointment requests, analyze availability, and send reminders via preferred channels.",
                gradient: "from-indigo-500/20 to-violet-500/20"
              }
            ].map((useCase, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="group relative"
              >
                <div className={`absolute -inset-0.5 bg-gradient-to-r ${useCase.gradient} rounded-xl opacity-20 group-hover:opacity-40 blur-lg transition duration-500`} />
                <div className="relative bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-white/20 transition h-full flex flex-col">
                  <div className="mb-4">{useCase.icon}</div>
                  <h3 className="text-lg font-bold mb-3">{useCase.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed flex-grow">{useCase.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features / Why AgentPilot */}
      <section id="features" className="relative z-10 py-16">
        <div className="max-w-7xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-3">
              <span className="text-orange-400">
                Why AgentPilot
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Built for everyone, from solopreneurs to teams
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <Sparkles className="w-12 h-12 text-orange-400" />,
                title: "No Code Required",
                description: "Just describe what you want in natural language. No programming, no complex workflows.",
                color: "orange"
              },
              {
                icon: <Volume2 className="w-12 h-12 text-amber-400" />,
                title: "Works With Your Tools",
                description: "Connect Gmail, Notion, Slack, Drive, Calendar, and more. We integrate with the apps you love.",
                color: "amber"
              },
              {
                icon: <Brain className="w-12 h-12 text-orange-400" />,
                title: "Smart Agent Builder",
                description: "Our AI understands context and builds sophisticated automations from simple descriptions.",
                color: "orange"
              },
              {
                icon: <Clock className="w-12 h-12 text-green-400" />,
                title: "Run or Schedule",
                description: "Execute agents on demand or set them to run automatically on your schedule.",
                color: "green"
              },
              {
                icon: <Lock className="w-12 h-12 text-orange-400" />,
                title: "Secure OAuth",
                description: "Industry-standard OAuth connections keep your data safe. We never store your passwords.",
                color: "orange"
              },
              {
                icon: <Zap className="w-12 h-12 text-amber-400" />,
                title: "Lightning Fast",
                description: "Go from idea to working automation in minutes, not hours or days.",
                color: "amber"
              }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="bg-gradient-to-br from-zinc-900/50 to-zinc-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-white/20 transition"
              >
                <div className="mb-4">{feature.icon}</div>
                <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative z-10 py-16">
        <div className="max-w-7xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-black mb-3">
              <span className="text-orange-400">
                Loved by Early Users
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {[
              {
                quote: "AgentPilot saved me 10 hours a week. I just tell it what I need, and it handles all my email-to-Notion workflows automatically.",
                author: "Sarah Chen",
                role: "Product Manager",
                avatar: "SC"
              },
              {
                quote: "I'm not technical at all, but I built 3 working agents in my first day. This is the future of personal automation.",
                author: "Marcus Rodriguez",
                role: "Marketing Director",
                avatar: "MR"
              }
            ].map((testimonial, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                className="h-full"
              >
                <div className="bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10 h-full flex flex-col">
                  <div className="text-3xl mb-3 text-slate-600">"</div>
                  <p className="text-base text-slate-300 mb-4 leading-relaxed italic flex-grow">
                    {testimonial.quote}
                  </p>
                  <div className="flex items-center gap-3 mt-auto">
                    <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center font-bold text-sm">
                      {testimonial.avatar}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{testimonial.author}</div>
                      <div className="text-xs text-slate-400">{testimonial.role}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-16">
        <div className="max-w-4xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="bg-zinc-900/95 backdrop-blur-2xl rounded-2xl p-8 md:p-12 border border-white/20 text-center">
              <h2 className="text-3xl md:text-4xl font-black mb-4">
                Be Among the First to Build
                <br />
                <span className="text-orange-400">
                  Your Personal AI Workforce
                </span>
              </h2>
              <p className="text-lg text-slate-300 mb-6 max-w-2xl mx-auto">
                No code. No setup. Start automating in minutes.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full sm:w-80 px-5 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition text-sm"
                />
                <button className="w-full sm:w-auto px-6 py-3 bg-orange-500 rounded-lg font-bold text-sm hover:bg-orange-600 hover:shadow-xl hover:shadow-orange-500/50 transition whitespace-nowrap">
                  Join Beta Now
                </button>
              </div>
              
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-6 h-6 text-green-400" />
                  <span>Free during beta</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-6 h-6 text-green-400" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-6 h-6 text-green-400" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}