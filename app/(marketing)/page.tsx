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
  Rocket
} from 'lucide-react';
import { SiGmail, SiSlack, SiNotion, SiGoogledrive, SiGooglecalendar, SiHubspot } from 'react-icons/si';

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
          className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-2xl md:rounded-3xl blur-xl md:blur-2xl"
        />
      )}

      <div className="relative w-16 h-16 md:w-24 md:h-24 bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl md:rounded-3xl flex items-center justify-center shadow-xl md:shadow-2xl border border-white/20">
        <div className="absolute inset-1 md:inset-2 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-xl md:rounded-2xl blur-sm" />

        <IconComponent className="w-10 h-10 text-blue-500" />
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
    <div className="w-12 md:w-24 h-1 md:h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full relative overflow-hidden">
      <div className="w-0 h-0 border-t-[6px] md:border-t-[8px] border-t-transparent border-l-[10px] md:border-l-[14px] border-l-pink-500 border-b-[6px] md:border-b-[8px] border-b-transparent absolute right-0 top-1/2 -translate-y-1/2" />
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
    <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-50 md:opacity-75 blur-lg md:blur-xl" />

    <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-2xl p-4 md:p-8 shadow-2xl border border-white/20">
      <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <Bot className="w-7 h-7 text-white" />
          </div>
          <h3 className="text-base md:text-xl font-bold text-white">Email Summary Bot</h3>
        </div>
        <div
          className={`px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-bold backdrop-blur-sm flex items-center gap-2 ${
            status === 'running'
              ? 'bg-gradient-to-r from-blue-500/30 to-purple-500/30 text-blue-200 border-2 border-blue-400/50'
              : 'bg-gradient-to-r from-green-500/30 to-emerald-500/30 text-green-200 border-2 border-green-400/50'
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
          <div className="w-full h-2 md:h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 3, ease: "easeInOut" }}
              className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
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
            <div className="relative bg-slate-800/60 backdrop-blur-sm rounded-xl p-4 md:p-6 border border-green-500/30">
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
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl md:rounded-2xl opacity-30 md:opacity-50 blur-lg md:blur-xl"></div>

      <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-xl md:rounded-2xl p-4 md:p-8 shadow-xl md:shadow-2xl border border-white/10">
        <div className="flex items-center gap-1.5 md:gap-2 mb-4 md:mb-6">
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-gradient-to-br from-red-400 to-red-600 rounded-full"></div>
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full"></div>
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-gradient-to-br from-green-400 to-green-600 rounded-full"></div>
          <div className="ml-auto text-xs text-slate-500 font-mono hidden sm:block">prompt.ai</div>
        </div>

        <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 rounded-lg md:rounded-xl p-3 md:p-6 min-h-[80px] md:min-h-[100px] flex items-center border border-white/5">
          <p className="relative text-white font-mono text-sm md:text-base lg:text-lg leading-relaxed break-words">
            {displayText}
            <span className="inline-block w-0.5 h-4 md:h-6 bg-gradient-to-b from-blue-400 to-purple-400 ml-1 rounded-full animate-pulse"></span>
          </p>
        </div>
      </div>
    </motion.div>
  );
};

const HeroAnimation = () => {
  const [step, setStep] = useState('typing');
  const [dashboardStatus, setDashboardStatus] = useState('running');

  const TIMINGS = {
    typing: 5000,
    building: 8000,  // Increased from 4500 to 8000 for all animations to complete
    connecting: 4000,
    dashboard: 6000,
    tagline: 4500,
  };

  useEffect(() => {
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
  }, [step]);

  return (
    <div className="min-h-[400px] md:min-h-[600px] flex items-center justify-center p-3 md:p-6">
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
                <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-blue-400" />
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
              className="flex flex-col items-center gap-4 md:gap-8 w-full max-w-4xl mx-auto"
            >
              <motion.h2
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xl md:text-3xl text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3 text-center"
              >
                <motion.div
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                >
                  <Settings className="w-6 h-6 md:w-8 md:h-8 text-blue-400 flex-shrink-0" />
                </motion.div>
                Building Your Workflow
              </motion.h2>

              {/* Workflow Builder Visualization */}
              <div className="relative w-full bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl md:rounded-2xl p-3 md:p-5 border border-blue-500/30 shadow-2xl">
                <div className="relative">
                  {/* AI Brain Building Animation */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex justify-center mb-3 md:mb-4"
                  >
                    <div className="relative">
                      <motion.div
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 0.8, 0.5]
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut"
                        }}
                        className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full blur-xl"
                      />
                      <div className="relative w-10 h-10 md:w-14 md:h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                        <Brain className="w-6 h-6 md:w-8 md:h-8 text-white" />
                      </div>
                    </div>
                  </motion.div>

                  {/* Building Steps - Staggered appearance */}
                  <div className="space-y-1.5 md:space-y-2">
                    {[
                      { icon: <FileSearch className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />, text: 'Analyzing your prompt...', delay: 0 },
                      { icon: <Link className="w-5 h-5 md:w-6 md:h-6 text-purple-400" />, text: 'Detecting plugins (Gmail, Slack)', delay: 0.4 },
                      { icon: <Settings className="w-5 h-5 md:w-6 md:h-6 text-cyan-400" />, text: 'Generating workflow logic', delay: 0.8 },
                      { icon: <BarChart3 className="w-5 h-5 md:w-6 md:h-6 text-green-400" />, text: 'Creating schemas', delay: 1.2 },
                      { icon: <Rocket className="w-5 h-5 md:w-6 md:h-6 text-pink-400" />, text: 'Optimizing flow', delay: 1.6 }
                    ].map((step, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: step.delay, duration: 0.5 }}
                        className="flex items-center gap-2 md:gap-3 bg-slate-800 rounded-lg md:rounded-xl p-2.5 md:p-3 border border-white/10 relative z-10"
                      >
                        <motion.div
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{
                            delay: step.delay,
                            duration: 0.5,
                            type: "spring",
                            stiffness: 200
                          }}
                          className="flex-shrink-0"
                        >
                          {step.icon}
                        </motion.div>
                        <div className="flex-1">
                          <p className="text-white font-medium text-xs md:text-sm">{step.text}</p>
                          <motion.div
                            initial={{ width: '0%' }}
                            animate={{ width: '100%' }}
                            transition={{ delay: step.delay + 0.2, duration: 0.8 }}
                            className="h-0.5 md:h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full mt-1.5 md:mt-2"
                          />
                        </div>
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            delay: step.delay + 1,
                            type: "spring",
                            stiffness: 200
                          }}
                          className="flex-shrink-0"
                        >
                          <CheckCircle className="w-5 h-5 md:w-6 md:h-6 text-green-400" />
                        </motion.div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Final Workflow Preview */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 2.2, duration: 0.5 }}
                    className="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-blue-500/30"
                  >
                    <p className="text-center text-xs md:text-sm text-slate-400 mb-3 md:mb-4">Your workflow is ready:</p>
                    <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5 md:gap-2 bg-slate-800 px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-white/10 relative z-10">
                        <SiGmail className="w-5 h-5 md:w-6 md:h-6 text-red-500" />
                        <span className="text-white font-medium text-xs md:text-sm">Gmail</span>
                      </div>
                      <motion.div
                        animate={{ x: [0, 5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="text-blue-400 text-sm md:text-base"
                      >
                        →
                      </motion.div>
                      <div className="flex items-center gap-1.5 md:gap-2 bg-slate-800 px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-white/10 relative z-10">
                        <Brain className="w-5 h-5 md:w-6 md:h-6 text-purple-500" />
                        <span className="text-white font-medium text-xs md:text-sm">AI Agent</span>
                      </div>
                      <motion.div
                        animate={{ x: [0, 5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
                        className="text-purple-400 text-sm md:text-base"
                      >
                        →
                      </motion.div>
                      <div className="flex items-center gap-1.5 md:gap-2 bg-slate-800 px-2 md:px-3 py-1.5 md:py-2 rounded-lg border border-white/10 relative z-10">
                        <SiSlack className="w-5 h-5 md:w-6 md:h-6 text-[#4A154B]" />
                        <span className="text-white font-medium text-xs md:text-sm">Slack</span>
                      </div>
                    </div>
                  </motion.div>
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
                className="text-xl md:text-3xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-400 font-bold mb-2 md:mb-4 flex items-center justify-center gap-2 md:gap-3 text-center"
              >
                <Zap className="w-6 h-6 md:w-8 md:h-8 text-cyan-400 flex-shrink-0" />
                Connecting Plugins
              </motion.h2>

              {/* Vertical connection visualization with checkmarks */}
              <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl md:rounded-2xl p-4 md:p-6 border border-cyan-500/30 shadow-2xl max-w-md w-full">
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
                      className="flex items-center gap-2.5 md:gap-3 bg-slate-800 rounded-lg md:rounded-xl p-2.5 md:p-3 border border-white/10 relative z-10"
                    >
                      <div className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center flex-shrink-0">
                        {item.type === 'mail' && <SiGmail className="w-6 h-6 md:w-8 md:h-8 text-red-500" />}
                        {item.type === 'brain' && <Brain className="w-6 h-6 md:w-8 md:h-8 text-purple-500" />}
                        {item.type === 'slack' && <SiSlack className="w-6 h-6 md:w-8 md:h-8 text-[#4A154B]" />}
                      </div>

                      <div className="flex-1">
                        <p className="text-white font-bold text-xs md:text-sm">{item.label}</p>
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: item.delay + 0.3 }}
                          className="text-cyan-400 text-xs font-medium"
                        >
                          Authenticating...
                        </motion.p>
                      </div>

                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: item.delay + 0.6, type: "spring", stiffness: 200 }}
                        className="w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br from-cyan-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0"
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
                    className="mt-4 md:mt-5 pt-3 md:pt-4 border-t border-cyan-500/30 text-center"
                  >
                    <p className="text-cyan-400 font-bold text-xs md:text-sm">All plugins connected successfully!</p>
                  </motion.div>
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
              className="flex flex-col items-center gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-bold mb-4 flex items-center justify-center gap-3"
              >
                <Bot className="w-8 h-8 text-purple-400" />
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
                  className="absolute inset-0 bg-gradient-to-r from-blue-500/30 via-purple-500/30 to-pink-500/30 blur-3xl"
                />
                
                <motion.h2
                  initial={{ backgroundPosition: '0% 50%' }}
                  animate={{ 
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                  className="relative text-5xl md:text-7xl font-black bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-6 bg-[length:200%_auto] drop-shadow-2xl"
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
  );
};

// ============================================================================
// LANDING PAGE COMPONENTS
// ============================================================================

export default function AgentPilotLanding() {
  const [email, setEmail] = useState('');

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
        <motion.div
          animate={{
            x: [0, 150, 0],
            y: [0, -150, 0],
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-20 left-20 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -150, 0],
            y: [0, 150, 0],
            scale: [1, 1.4, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, 100, -100, 0],
            y: [0, -100, 100, 0],
            scale: [1, 1.2, 1.3, 1],
            opacity: [0.2, 0.4, 0.3, 0.2]
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/15 rounded-full blur-3xl"
        />
      </div>

      {/* Hero Section */}
      <section className="relative z-10 pt-12 md:pt-20 pb-12 md:pb-20">
        <div className="max-w-7xl mx-auto px-6">
          {/* Hero Text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-8 md:mb-12"
          >
            <motion.h1 
              className="text-5xl md:text-7xl font-black mb-6 leading-tight"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Your Personal AI Workforce
              </span>
              <br />
              <span className="text-white">Ready in Minutes</span>
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-xl md:text-2xl text-slate-300 max-w-4xl mx-auto mb-8 leading-relaxed"
            >
              AgentPilot turns natural language into real, working AI automations — no code, no setup.
              <br />
              Just describe what you want, connect your tools once, and your personal AI pilot does the rest.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <button className="group px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-bold text-lg hover:shadow-2xl hover:shadow-purple-500/50 transition flex items-center gap-2">
                Create Your First Agent
                <ArrowRight className="w-5 h-5" />
              </button>
            </motion.div>
          </motion.div>

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

      {/* Plugin Integrations */}
      <section className="relative z-10 py-12 border-y border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-slate-400 mb-8">Works with your favorite tools</p>
          <div className="flex flex-wrap items-center justify-center gap-12 opacity-70">
            {/* Gmail */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <SiGmail className="w-8 h-8 text-red-500" />
              <span className="text-slate-300 font-medium">Gmail</span>
            </div>

            {/* Slack */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <SiSlack className="w-8 h-8 text-[#4A154B]" />
              <span className="text-slate-300 font-medium">Slack</span>
            </div>

            {/* Notion */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <SiNotion className="w-8 h-8 text-white" />
              <span className="text-slate-300 font-medium">Notion</span>
            </div>

            {/* Google Drive */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <SiGoogledrive className="w-8 h-8 text-[#4285F4]" />
              <span className="text-slate-300 font-medium">Google Drive</span>
            </div>

            {/* Google Calendar */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <SiGooglecalendar className="w-8 h-8 text-[#4285F4]" />
              <span className="text-slate-300 font-medium">Calendar</span>
            </div>

            {/* And more indicator */}
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-2xl">+</span>
              <span className="text-sm font-medium">15 more</span>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="relative z-10 py-32">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                How It Works
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              From prompt to production in three simple steps
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Describe Your Goal",
                description: "Tell AgentPilot what you want in plain English. No technical knowledge required.",
                icon: <MessageSquare className="w-12 h-12 text-blue-400" />,
                color: "blue"
              },
              {
                step: "02",
                title: "AI Builds Your Agent",
                description: "Our AI automatically creates the workflow, connects the right tools, and configures everything.",
                icon: <Sparkles className="w-12 h-12 text-purple-400" />,
                color: "purple"
              },
              {
                step: "03",
                title: "Connect & Run",
                description: "Authorize your tools once with OAuth, then run on demand or schedule automatically.",
                icon: <Zap className="w-12 h-12 text-pink-400" />,
                color: "pink"
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
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-0 group-hover:opacity-75 blur-lg transition duration-500" />
                <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10 h-full">
                  <div className="mb-6">{item.icon}</div>
                  <div className="text-sm font-bold text-slate-500 mb-2">STEP {item.step}</div>
                  <h3 className="text-2xl font-bold mb-4">{item.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="relative z-10 py-32 bg-gradient-to-b from-transparent via-slate-900/20 to-transparent">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                What You Can Do
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Automate your work across the tools you already use
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
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
                <div className={`absolute -inset-0.5 bg-gradient-to-r ${useCase.gradient} rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500`} />
                <div className="relative bg-slate-900/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10">
                  <h3 className="text-2xl font-bold mb-3">{useCase.title}</h3>
                  <p className="text-slate-400 mb-6 leading-relaxed">{useCase.description}</p>
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
      <section id="features" className="relative z-10 py-32">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Why AgentPilot
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Built for everyone, from solopreneurs to teams
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: <Sparkles className="w-12 h-12 text-blue-400" />,
                title: "No Code Required",
                description: "Just describe what you want in natural language. No programming, no complex workflows.",
                color: "blue"
              },
              {
                icon: <Volume2 className="w-12 h-12 text-purple-400" />,
                title: "Works With Your Tools",
                description: "Connect Gmail, Notion, Slack, Drive, Calendar, and more. We integrate with the apps you love.",
                color: "purple"
              },
              {
                icon: <Brain className="w-12 h-12 text-pink-400" />,
                title: "Smart Agent Builder",
                description: "Our AI understands context and builds sophisticated automations from simple descriptions.",
                color: "pink"
              },
              {
                icon: <Clock className="w-12 h-12 text-green-400" />,
                title: "Run or Schedule",
                description: "Execute agents on demand or set them to run automatically on your schedule.",
                color: "green"
              },
              {
                icon: <Lock className="w-12 h-12 text-blue-400" />,
                title: "Secure OAuth",
                description: "Industry-standard OAuth connections keep your data safe. We never store your passwords.",
                color: "blue"
              },
              {
                icon: <Zap className="w-12 h-12 text-purple-400" />,
                title: "Lightning Fast",
                description: "Go from idea to working automation in minutes, not hours or days.",
                color: "purple"
              }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-xl rounded-2xl p-8 border border-white/10 hover:border-white/20 transition"
              >
                <div className="mb-6">{feature.icon}</div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-slate-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative z-10 py-32 bg-gradient-to-b from-transparent via-slate-900/20 to-transparent">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Loved by Early Users
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
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
                className="relative group"
              >
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500" />
                <div className="relative bg-slate-900/90 backdrop-blur-xl rounded-2xl p-8 border border-white/10">
                  <div className="text-4xl mb-4 text-slate-600">"</div>
                  <p className="text-lg text-slate-300 mb-6 leading-relaxed italic">
                    {testimonial.quote}
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold">
                      {testimonial.avatar}
                    </div>
                    <div>
                      <div className="font-semibold">{testimonial.author}</div>
                      <div className="text-sm text-slate-400">{testimonial.role}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-32">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-75 blur-2xl group-hover:opacity-100 transition duration-1000" />
            <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-3xl p-12 md:p-16 border border-white/20 text-center">
              <h2 className="text-4xl md:text-5xl font-black mb-6">
                Be Among the First to Build
                <br />
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Your Personal AI Workforce
                </span>
              </h2>
              <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                No code. No setup. Start automating in minutes.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full sm:w-80 px-6 py-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition"
                />
                <button className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-bold text-lg hover:shadow-2xl hover:shadow-purple-500/50 transition whitespace-nowrap">
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