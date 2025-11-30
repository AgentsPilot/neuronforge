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
  Network
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
      <div className="min-h-[400px] md:min-h-[600px] flex items-center justify-center p-3 md:p-6 w-full">
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
        className="w-full px-4 md:px-8 mt-8 md:mt-12"
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
        <div className="relative max-w-7xl mx-auto px-4 lg:px-6 py-8 md:py-12 lg:py-14">
          <div className="grid lg:grid-cols-2 gap-8 items-center">

            {/* Left side - Text content - Reorganized */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="space-y-8 max-w-xl"
            >
              {/* Main heading - Split across lines */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="space-y-2"
              >
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-black leading-tight">
                  <span className="text-orange-400 block">
                    Your Personal
                  </span>
                  <span className="text-orange-400 block">
                    AI Workforce
                  </span>
                </h1>
                <p className="text-lg md:text-xl text-slate-400 font-medium">
                  Ready in Minutes
                </p>
              </motion.div>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-base md:text-lg text-slate-300 leading-relaxed"
              >
                AgentPilot turns natural language into real, working AI automations. No code, no setup. Just describe what you want, connect your tools once, and your personal AI pilot does the rest.
              </motion.p>

              {/* CTA Button */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.5 }}
              >
                <a href="/signup">
                  <button className="group relative px-6 py-2.5 bg-orange-500 rounded-lg font-bold text-sm text-white hover:shadow-xl hover:shadow-orange-500/50 hover:bg-orange-600 transition-all duration-300 hover:scale-105 overflow-hidden">
                    <span className="relative flex items-center justify-center gap-2">
                      Create Your First Agent
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </button>
                </a>
              </motion.div>

              {/* Trust indicators - Single horizontal line */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex flex-wrap items-center gap-4 pt-4 border-t border-white/10 text-sm text-slate-400"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Free beta access</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Setup in under 2 minutes</span>
                </div>
              </motion.div>
            </motion.div>

            {/* Right side - Futuristic AI visual */}
            <motion.div
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="relative flex items-center justify-center lg:justify-end"
            >
              {/* Animated circuit connections - Top corners */}
              <svg className="absolute top-0 right-0 w-64 h-64 opacity-30" xmlns="http://www.w3.org/2000/svg">
                <motion.path
                  d="M 20 20 L 100 20 L 100 80 L 180 80"
                  stroke="url(#grad-top)"
                  strokeWidth="2"
                  fill="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.6 }}
                  transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
                />
                <motion.circle cx="100" cy="20" r="5" fill="#60A5FA" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }} />
                <motion.circle cx="180" cy="80" r="5" fill="#A78BFA" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity, delay: 0.5 }} />
                <defs>
                  <linearGradient id="grad-top" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.8" />
                  </linearGradient>
                </defs>
              </svg>

              <svg className="absolute bottom-0 left-0 w-64 h-64 opacity-30" xmlns="http://www.w3.org/2000/svg">
                <motion.path
                  d="M 20 240 L 100 240 L 100 180 L 180 180"
                  stroke="url(#grad-bottom)"
                  strokeWidth="2"
                  fill="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.6 }}
                  transition={{ duration: 2, repeat: Infinity, repeatType: "reverse", delay: 1 }}
                />
                <motion.circle cx="20" cy="240" r="5" fill="#06B6D4" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity, delay: 1 }} />
                <motion.circle cx="180" cy="180" r="5" fill="#EC4899" animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity, delay: 1.5 }} />
                <defs>
                  <linearGradient id="grad-bottom" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#EC4899" stopOpacity="0.8" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Central AI visualization */}
              <div className="relative">
                <motion.div
                  animate={{ y: [0, -15, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="relative"
                >
                  {/* Outer glow ring */}
                  <motion.div
                    animate={{
                      scale: [1, 1.15, 1],
                      opacity: [0.3, 0.6, 0.3]
                    }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-orange-500/40 blur-3xl rounded-full"
                  />

                  {/* Main sphere */}
                  <div className="relative w-64 h-64 md:w-80 md:h-80 rounded-full bg-zinc-800/80 backdrop-blur-xl border border-white/10 shadow-2xl flex items-center justify-center overflow-visible">

                    {/* Inner gradient orb */}
                    <div className="absolute inset-12 rounded-full bg-orange-500/20 blur-2xl" />

                    {/* Bot Icon */}
                    <Bot className="w-32 h-32 md:w-40 md:h-40 text-orange-400 relative z-10" />

                    {/* Rotating orbital rings with icons */}
                    {/* Outer ring - 7 icons evenly spaced ON the ring */}
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-[-20px] overflow-visible"
                    >
                      <div className="absolute inset-[20px] border-2 border-orange-500/20 rounded-full" style={{ borderStyle: 'dashed', borderSpacing: '10px' }} />

                      {/* Gmail - 0deg */}
                      <div className="absolute top-[20px] left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <PluginIcon pluginId="google-mail" className="w-5 h-5 text-red-400" alt="Gmail" />
                      </div>
                      {/* Slack - 51.4deg */}
                      <div className="absolute top-1/2 right-[20px] translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg" style={{ transform: 'rotate(-51.4deg) translateX(170px) rotate(51.4deg) translate(-50%, -50%)' }}>
                        <PluginIcon pluginId="slack" className="w-5 h-5 text-purple-300" alt="Slack" />
                      </div>
                      {/* Drive - 102.8deg */}
                      <div className="absolute right-[20px] top-1/2 translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <PluginIcon pluginId="google-drive" className="w-5 h-5 text-orange-400" alt="Google Drive" />
                      </div>
                      {/* Google Sheets - 154.2deg */}
                      <div className="absolute bottom-[20px] right-[20px] translate-x-1/2 translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <PluginIcon pluginId="google-sheets" className="w-5 h-5 text-green-400" alt="Google Sheets" />
                      </div>
                      {/* Calendar - 205.7deg */}
                      <div className="absolute bottom-[20px] left-1/2 -translate-x-1/2 translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <PluginIcon pluginId="google-calendar" className="w-5 h-5 text-amber-400" alt="Google Calendar" />
                      </div>
                      {/* HubSpot - 257.1deg */}
                      <div className="absolute bottom-[20px] left-[20px] -translate-x-1/2 translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <PluginIcon pluginId="hubspot" className="w-5 h-5 text-orange-400" alt="HubSpot" />
                      </div>
                      {/* Brain - 308.5deg */}
                      <div className="absolute left-[20px] top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-zinc-800/90 backdrop-blur-sm border border-orange-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Brain className="w-4 h-4 text-amber-300" />
                      </div>
                    </motion.div>

                    {/* Middle ring - 7 icons evenly spaced ON the ring */}
                    <motion.div
                      animate={{ rotate: -360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-[-12px] overflow-visible"
                    >
                      <div className="absolute inset-[20px] border-2 border-amber-500/20 rounded-full" style={{ borderStyle: 'dashed' }} />

                      {/* Zap - 0deg */}
                      <div className="absolute top-[20px] left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Zap className="w-4 h-4 text-amber-400" />
                      </div>
                      {/* Workflow - 51.4deg */}
                      <div className="absolute top-[20px] right-[20px] translate-x-1/2 -translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Workflow className="w-4 h-4 text-orange-400" />
                      </div>
                      {/* Lock - 102.8deg */}
                      <div className="absolute right-[20px] top-1/2 translate-x-1/2 -translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Lock className="w-4 h-4 text-green-400" />
                      </div>
                      {/* Repeat - 154.2deg */}
                      <div className="absolute bottom-[20px] right-[20px] translate-x-1/2 translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Repeat className="w-4 h-4 text-amber-400" />
                      </div>
                      {/* Network - 205.7deg */}
                      <div className="absolute bottom-[20px] left-1/2 -translate-x-1/2 translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Network className="w-4 h-4 text-amber-300" />
                      </div>
                      {/* Sparkles - 257.1deg */}
                      <div className="absolute bottom-[20px] left-[20px] -translate-x-1/2 translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Sparkles className="w-4 h-4 text-orange-400" />
                      </div>
                      {/* Agent Bot - 308.5deg */}
                      <div className="absolute left-[20px] top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 bg-zinc-800/90 backdrop-blur-sm border border-amber-400/30 rounded-lg flex items-center justify-center shadow-lg">
                        <Bot className="w-4 h-4 text-orange-300" />
                      </div>
                    </motion.div>

                    {/* Inner ring - Just the ring, no icons */}
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-[44px] overflow-visible"
                    >
                      <div className="absolute inset-0 border-2 border-orange-600/20 rounded-full" style={{ borderStyle: 'dashed' }} />
                    </motion.div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Workflow Animation Section */}
      <section className="relative z-10 pt-4 pb-0 md:pt-6 md:pb-0 lg:pt-8 lg:pb-0">
        <div className="max-w-7xl mx-auto px-6">

          {/* Hero Animation */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
          >
            <HeroAnimation />
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
                What You Can Do
              </span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Automate your work across the tools you already use
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                title: "Email → Notion",
                description: "Automatically summarize important emails and save them to your Notion workspace",
                tools: ["Gmail", "Notion"],
                gradient: "from-red-500/20 to-slate-500/20"
              },
              {
                title: "Email → Drive",
                description: "Extract and save invoice attachments to organized folders in Google Drive",
                tools: ["Gmail", "Google Drive"],
                gradient: "from-red-500/20 to-blue-500/20"
              },
              {
                title: "Calendar → Slack",
                description: "Post daily meeting summaries and action items to your team's Slack channel",
                tools: ["Google Calendar", "Slack"],
                gradient: "from-blue-500/20 to-purple-500/20"
              },
              {
                title: "Research → Email",
                description: "Send daily trend reports on topics you care about directly to your inbox",
                tools: ["Web Search", "Gmail"],
                gradient: "from-green-500/20 to-red-500/20"
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
                <div className="relative bg-zinc-900/90 backdrop-blur-xl rounded-xl p-6 border border-white/10">
                  <h3 className="text-xl font-bold mb-2">{useCase.title}</h3>
                  <p className="text-sm text-slate-400 mb-4 leading-relaxed">{useCase.description}</p>
                  <div className="flex items-center gap-3">
                    {useCase.tools.map((tool, i) => (
                      <React.Fragment key={i}>
                        <span className="px-3 py-1.5 bg-white/5 rounded-lg text-sm font-medium text-slate-300 border border-white/10">
                          {tool}
                        </span>
                        {i < useCase.tools.length - 1 && (
                          <ArrowRight className="w-5 h-5" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
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