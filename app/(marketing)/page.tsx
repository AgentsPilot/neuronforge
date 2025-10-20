'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// HERO ANIMATION COMPONENTS
// ============================================================================

type AnimationStep = 'typing' | 'building' | 'connecting' | 'dashboard' | 'tagline';

// Modern SVG Icons for Hero Animation
const MailIcon = () => (
  <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" className="fill-blue-500"/>
    <path d="m22 6-10 7L2 6" stroke="white" strokeWidth="2" fill="none"/>
  </svg>
);

const BrainIcon = () => (
  <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none">
    <path d="M12 3C8.5 3 6 5.5 6 8.5c0 1.5-.7 2.8-1.8 3.5C3.5 12.5 3 13.7 3 15c0 2.8 2.2 5 5 5h8c2.8 0 5-2.2 5-5 0-1.3-.5-2.5-1.2-3-.5-.3-1.1-.7-1.4-1.2-.6-.9-1.4-1.8-1.4-2.8 0-3-2.5-5.5-6-5.5z" className="fill-purple-500"/>
    <circle cx="9" cy="12" r="1.5" className="fill-white"/>
    <circle cx="15" cy="12" r="1.5" className="fill-white"/>
    <path d="M10 16h4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const SlackIcon = () => (
  <svg className="w-10 h-10" viewBox="0 0 54 54" fill="none">
    <path d="M19.715 34.542a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h4.5v4.5z" className="fill-green-400"/>
    <path d="M21.965 34.542a4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v11.25a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5V34.542z" className="fill-green-400"/>
    <path d="M26.465 19.5a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v4.5h-4.5z" className="fill-blue-400"/>
    <path d="M26.465 21.75a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H15.215a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h11.25z" className="fill-blue-400"/>
    <path d="M41.535 26.25a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5v-4.5h4.5z" className="fill-yellow-400"/>
    <path d="M39.285 26.25a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v11.25a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5V26.25z" className="fill-yellow-400"/>
    <path d="M34.785 41.5a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5v-4.5h4.5z" className="fill-pink-400"/>
    <path d="M34.785 39.25a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h11.25a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H34.785z" className="fill-pink-400"/>
  </svg>
);

const RobotIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
    <path d="M8 2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2a6 6 0 0 1 6 6v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-8a6 6 0 0 1 6-6V2z" className="fill-purple-500"/>
    <circle cx="9" cy="12" r="1.5" className="fill-white"/>
    <circle cx="15" cy="12" r="1.5" className="fill-white"/>
    <path d="M9 16h6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="12" cy="4" r="1" className="fill-purple-300"/>
  </svg>
);

const Icon = ({ type, label, pulse = false, delay = 0 }) => {
  const icons = {
    mail: <MailIcon />,
    brain: <BrainIcon />,
    slack: <SlackIcon />,
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 40, rotateY: -90 }}
      animate={{ 
        opacity: 1, 
        scale: pulse ? [1, 1.2, 1] : 1,
        y: 0,
        rotateY: 0
      }}
      transition={{ 
        duration: 0.8,
        delay,
        scale: { 
          repeat: pulse ? Infinity : 0, 
          duration: 2.5,
          ease: "easeInOut"
        }
      }}
      className="flex flex-col items-center gap-3 relative"
    >
      {pulse && (
        <>
          <motion.div
            animate={{
              opacity: [0.2, 0.6, 0.2],
              scale: [1, 1.6, 1],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-3xl blur-2xl"
          />
          
          <motion.div
            animate={{
              opacity: [0.8, 0, 0.8],
              scale: [1, 2, 1],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: "easeOut"
            }}
            className="absolute inset-0 border-2 border-blue-400 rounded-3xl"
          />
        </>
      )}
      
      <motion.div
        animate={pulse ? {
          rotateY: [0, 10, -10, 0],
        } : {}}
        transition={{
          duration: 4,
          repeat: pulse ? Infinity : 0,
          ease: "easeInOut"
        }}
        className="relative w-24 h-24 bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-3xl flex items-center justify-center shadow-2xl border border-white/20"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div className="absolute inset-2 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-2xl blur-sm" />
        
        <motion.div
          animate={pulse ? {
            scale: [1, 1.1, 1],
          } : {}}
          transition={{
            duration: 2.5,
            repeat: pulse ? Infinity : 0,
          }}
        >
          {icons[type]}
        </motion.div>
        
        <motion.div
          animate={{
            x: [-100, 100],
            opacity: [0, 0.5, 0]
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            repeatDelay: 2
          }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 rounded-3xl"
        />
      </motion.div>
      
      <motion.span
        animate={pulse ? {
          opacity: [0.7, 1, 0.7]
        } : {}}
        transition={{
          duration: 2,
          repeat: pulse ? Infinity : 0
        }}
        className="text-sm text-slate-300 font-bold"
      >
        {label}
      </motion.span>
    </motion.div>
  );
};

const Arrow = ({ delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, scaleX: 0 }}
    animate={{ opacity: 1, scaleX: 1 }}
    transition={{ duration: 0.8, delay, ease: "easeOut" }}
    className="flex items-center relative"
  >
    <div className="w-24 h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full relative overflow-hidden shadow-lg">
      <motion.div
        animate={{ x: [-40, 120] }}
        transition={{ 
          duration: 2.5, 
          repeat: Infinity,
          ease: "easeInOut",
          repeatDelay: 0.5
        }}
        className="absolute inset-0 w-12 bg-gradient-to-r from-transparent via-white/80 to-transparent"
      />
      
      <motion.div
        animate={{ 
          x: [0, 90],
          opacity: [0, 1, 0]
        }}
        transition={{ 
          duration: 2, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute top-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-full shadow-lg shadow-white/50"
      />
    </div>
    
    <motion.div
      animate={{ 
        x: [0, 6, 0],
        filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)']
      }}
      transition={{ 
        duration: 2.5, 
        repeat: Infinity,
        ease: "easeInOut"
      }}
      className="absolute right-0 drop-shadow-lg"
    >
      <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[14px] border-l-pink-500 border-b-[8px] border-b-transparent" />
      <motion.div
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute -inset-2 bg-pink-500/30 blur-md rounded-full"
      />
    </motion.div>
  </motion.div>
);

const DashboardCard = ({ status }) => (
  <motion.div
    initial={{ opacity: 0, y: 60, scale: 0.8, rotateX: -20 }}
    animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
    transition={{ duration: 1, ease: "easeOut" }}
    className="relative max-w-lg w-full group"
    style={{ transformStyle: 'preserve-3d' }}
  >
    <motion.div 
      animate={{
        rotate: [0, 360],
      }}
      transition={{
        duration: 8,
        repeat: Infinity,
        ease: "linear"
      }}
      className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-75 blur-xl"
    />
    
    <motion.div
      animate={{
        opacity: [0.5, 1, 0.5],
        scale: [0.98, 1.02, 0.98]
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      className="absolute -inset-2 bg-gradient-to-r from-blue-600/30 via-purple-600/30 to-pink-600/30 rounded-2xl blur-2xl"
    />
    
    <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl rounded-2xl p-8 shadow-2xl border border-white/20">
      <motion.div
        animate={{
          y: [-20, 20, -20],
          x: [-10, 10, -10],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute top-4 right-4 w-2 h-2 bg-blue-400 rounded-full blur-sm opacity-50"
      />
      <motion.div
        animate={{
          y: [20, -20, 20],
          x: [10, -10, 10],
        }}
        transition={{
          duration: 7,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute bottom-4 left-4 w-2 h-2 bg-purple-400 rounded-full blur-sm opacity-50"
      />
      
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <motion.div
            animate={{
              rotate: [0, 360],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "linear"
            }}
            className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg"
          >
            <RobotIcon />
          </motion.div>
          <h3 className="text-xl font-bold text-white">Email Summary Bot</h3>
        </div>
        <motion.div
          animate={status === 'running' ? { 
            opacity: [1, 0.6, 1],
            boxShadow: ['0 0 20px rgba(59, 130, 246, 0.5)', '0 0 40px rgba(147, 51, 234, 0.8)', '0 0 20px rgba(59, 130, 246, 0.5)']
          } : {
            scale: [0.9, 1.1, 1],
            boxShadow: ['0 0 20px rgba(34, 197, 94, 0.5)', '0 0 40px rgba(34, 197, 94, 0.8)', '0 0 20px rgba(34, 197, 94, 0.5)']
          }}
          transition={{ 
            duration: status === 'running' ? 2.5 : 0.6,
            repeat: status === 'running' ? Infinity : 0 
          }}
          className={`px-5 py-2.5 rounded-xl text-sm font-bold backdrop-blur-sm ${
            status === 'running' 
              ? 'bg-gradient-to-r from-blue-500/30 to-purple-500/30 text-blue-200 border-2 border-blue-400/50' 
              : 'bg-gradient-to-r from-green-500/30 to-emerald-500/30 text-green-200 border-2 border-green-400/50'
          }`}
        >
          {status === 'running' ? '⚡ Running...' : '✨ Completed'}
        </motion.div>
      </div>

      {status === 'running' && (
        <div className="mb-6">
          <div className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden backdrop-blur-sm shadow-inner">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 3, ease: "easeInOut" }}
              className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 relative shadow-lg"
            >
              <motion.div
                animate={{ x: [-40, 500] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 w-24 bg-gradient-to-r from-transparent via-white/60 to-transparent"
              />
              
              <motion.div
                className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg"
                animate={{
                  boxShadow: ['0 0 10px rgba(255,255,255,0.8)', '0 0 20px rgba(255,255,255,1)', '0 0 10px rgba(255,255,255,0.8)']
                }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            </motion.div>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {status === 'completed' && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.4, type: "spring" }}
            className="relative"
          >
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0.5],
                  x: [0, (Math.random() - 0.5) * 100],
                  y: [0, -50 - Math.random() * 50],
                  rotate: [0, Math.random() * 360]
                }}
                transition={{
                  duration: 1.2,
                  delay: 0.4 + i * 0.1,
                  ease: "easeOut"
                }}
                className={`absolute top-0 left-1/2 w-2 h-2 rounded-full ${
                  i % 3 === 0 ? 'bg-green-400' : i % 3 === 1 ? 'bg-blue-400' : 'bg-purple-400'
                }`}
              />
            ))}
            
            <div className="absolute -inset-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-xl blur-xl"></div>
            <motion.div
              animate={{
                boxShadow: ['0 0 20px rgba(34, 197, 94, 0.3)', '0 0 40px rgba(34, 197, 94, 0.5)', '0 0 20px rgba(34, 197, 94, 0.3)']
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="relative bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-green-500/30"
            >
              <div className="flex items-center gap-2 mb-4">
                <motion.svg 
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1, delay: 0.6 }}
                  className="w-7 h-7" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2.5"
                >
                  <motion.path 
                    d="M3 3v18h18" 
                    className="text-green-400"
                  />
                  <motion.path 
                    d="M18 17l-5-5-3 3-4-4" 
                    className="text-green-400"
                  />
                </motion.svg>
                <p className="text-lg text-green-300 font-bold">Output</p>
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, staggerChildren: 0.1 }}
              >
                <motion.p 
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-slate-300 leading-relaxed mb-1"
                >
                  ✓ 5 emails summarized
                </motion.p>
                <motion.p 
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 1.0 }}
                  className="text-slate-300 leading-relaxed mb-1"
                >
                  ✓ 2 action items sent to Slack
                </motion.p>
                <motion.p 
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 1.1 }}
                  className="text-slate-300 leading-relaxed"
                >
                  ✓ Team notified successfully
                </motion.p>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </motion.div>
);

const TypingPrompt = ({ text }) => {
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
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="relative max-w-3xl w-full group"
    >
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-xl transition duration-1000"></div>
      
      <div className="relative bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-2xl rounded-2xl p-8 shadow-2xl border border-white/10">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-3.5 h-3.5 bg-gradient-to-br from-red-400 to-red-600 rounded-full"></div>
          <div className="w-3.5 h-3.5 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full"></div>
          <div className="w-3.5 h-3.5 bg-gradient-to-br from-green-400 to-green-600 rounded-full"></div>
          <div className="ml-auto text-xs text-slate-500 font-mono">prompt.ai</div>
        </div>
        
        <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-xl p-6 min-h-[100px] flex items-center border border-white/5 relative overflow-hidden">
          <motion.div
            animate={{
              opacity: [0.03, 0.08, 0.03],
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500"
          />
          
          <p className="relative text-white font-mono text-base md:text-lg leading-relaxed">
            {displayText}
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="inline-block w-0.5 h-6 bg-gradient-to-b from-blue-400 to-purple-400 ml-1 rounded-full"
            />
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
    building: 4500,
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
    <div className="min-h-[600px] flex items-center justify-center p-6">
      <div className="relative z-10 w-full max-w-6xl">
        <AnimatePresence mode="wait">
          {step === 'typing' && (
            <motion.div
              key="typing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="flex flex-col items-center gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl text-transparent bg-clip-text bg-gradient-to-r from-slate-300 to-slate-500 font-bold mb-4 flex items-center justify-center gap-3"
              >
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" className="fill-blue-400"/>
                </svg>
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
              transition={{ duration: 0.6 }}
              className="flex flex-col items-center gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 font-bold mb-4 flex items-center justify-center gap-3"
              >
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z" className="fill-blue-400"/>
                  <path d="M9 12.75L11.25 15 15 9.75" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                Building Your Workflow
              </motion.h2>
              <div className="flex items-center gap-6">
                <Icon type="mail" label="Gmail" delay={0} />
                <Arrow delay={0.4} />
                <Icon type="brain" label="AI Agent" delay={0.7} />
                <Arrow delay={1.0} />
                <Icon type="slack" label="Slack" delay={1.3} />
              </div>
            </motion.div>
          )}

          {step === 'connecting' && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="flex flex-col items-center gap-8"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400 font-bold mb-4 flex items-center justify-center gap-3"
              >
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636a9 9 0 1012.728 0l-1.591 1.591M12 6.75a5.25 5.25 0 110 10.5 5.25 5.25 0 010-10.5z" className="fill-green-400"/>
                  <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                Connecting Plugins
              </motion.h2>
              <div className="flex items-center gap-6">
                <Icon type="mail" label="Connected ✅" pulse delay={0} />
                <Arrow />
                <Icon type="brain" label="Connected ✅" pulse delay={0.3} />
                <Arrow />
                <Icon type="slack" label="Connected ✅" pulse delay={0.6} />
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
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <path d="M10.5 1.875a1.125 1.125 0 012.25 0v8.219c0 .621.504 1.125 1.125 1.125h8.25a1.125 1.125 0 010 2.25h-8.25a1.125 1.125 0 01-1.125-1.125V3.375a1.125 1.125 0 01-1.125-1.125h8.25zM9 12.75a.75.75 0 00.75.75h.008a.75.75 0 00.75-.75v-.008a.75.75 0 00-.75-.75H9.75a.75.75 0 00-.75.75v.008zM5.25 12.75a.75.75 0 00.75.75h.008a.75.75 0 00.75-.75v-.008a.75.75 0 00-.75-.75H6a.75.75 0 00-.75.75v.008zM1.5 12.75a.75.75 0 00.75.75h.008a.75.75 0 00.75-.75v-.008a.75.75 0 00-.75-.75H2.25a.75.75 0 00-.75.75v.008z" className="fill-purple-400"/>
                  <path d="M3.375 3C2.339 3 1.5 3.84 1.5 4.875v11.25C1.5 17.16 2.34 18 3.375 18H9.75v1.5H6A.75.75 0 006 21h12a.75.75 0 000-1.5h-3.75V18h6.375c1.035 0 1.875-.84 1.875-1.875V4.875C22.5 3.839 21.66 3 20.625 3H3.375z" className="fill-pink-400"/>
                </svg>
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
                    <motion.svg 
                      animate={{
                        rotate: [0, 10, -10, 0],
                        scale: [1, 1.2, 1]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="w-8 h-8" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2.5"
                    >
                      <motion.path 
                        d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" 
                        className="text-yellow-400 fill-yellow-400"
                        animate={{
                          opacity: [0.6, 1, 0.6]
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity
                        }}
                      />
                    </motion.svg>
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

const CheckIcon = () => (
  <svg className="w-6 h-6 text-green-400" viewBox="0 0 24 24" fill="none">
    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2.5" fill="none"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PlayIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 000-1.69L9.54 5.98A.998.998 0 008 6.82z" fill="currentColor"/>
  </svg>
);

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
      <section className="relative z-10 pt-20 pb-32">
        <div className="max-w-7xl mx-auto px-6">
          {/* Hero Text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
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
                <ArrowRightIcon />
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
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-.904.732-1.636 1.636-1.636a1.636 1.636 0 0 1 .909.273L12 9.375l9.455-5.281a1.636 1.636 0 0 1 .909-.273C23.268 3.821 24 4.553 24 5.457z" className="fill-red-500"/>
              </svg>
              <span className="text-slate-300 font-medium">Gmail</span>
            </div>

            {/* Slack */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <svg className="w-8 h-8" viewBox="0 0 54 54" fill="none">
                <path d="M19.715 34.542a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h4.5v4.5z" className="fill-green-400"/>
                <path d="M21.965 34.542a4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v11.25a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5V34.542z" className="fill-green-400"/>
                <path d="M26.465 19.5a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v4.5h-4.5z" className="fill-blue-400"/>
                <path d="M26.465 21.75a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H15.215a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h11.25z" className="fill-blue-400"/>
                <path d="M41.535 26.25a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5v-4.5h4.5z" className="fill-yellow-400"/>
                <path d="M39.285 26.25a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v11.25a4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5V26.25z" className="fill-yellow-400"/>
                <path d="M34.785 41.5a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5 4.5 4.5 0 0 1-4.5-4.5v-4.5h4.5z" className="fill-pink-400"/>
                <path d="M34.785 39.25a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1 4.5-4.5h11.25a4.5 4.5 0 0 1 4.5 4.5 4.5 4.5 0 0 1-4.5 4.5H34.785z" className="fill-pink-400"/>
              </svg>
              <span className="text-slate-300 font-medium">Slack</span>
            </div>

            {/* Notion */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                <path d="M4.459 4.208c.746.606 1.026.56 2.428.465l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.934zm14.337-.653c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933l3.269-.186z" className="fill-slate-300"/>
              </svg>
              <span className="text-slate-300 font-medium">Notion</span>
            </div>

            {/* Google Drive */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                <path d="M8.203 5.3L4.09 12.837h8.226L16.428 5.3H8.203z" className="fill-yellow-500"/>
                <path d="M15.3 6.428l-4.113 7.538L15.3 21.504l8.226-7.538L15.3 6.428z" className="fill-blue-500"/>
                <path d="M8.203 18.201L0 18.201l4.113-7.538 8.204 7.538z" className="fill-green-500"/>
              </svg>
              <span className="text-slate-300 font-medium">Google Drive</span>
            </div>

            {/* Google Calendar */}
            <div className="flex items-center gap-3 group hover:opacity-100 transition">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" className="fill-blue-500"/>
              </svg>
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
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" className="fill-blue-400"/>
                  </svg>
                ),
                color: "blue"
              },
              {
                step: "02",
                title: "AI Builds Your Agent",
                description: "Our AI automatically creates the workflow, connects the right tools, and configures everything.",
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" className="fill-purple-400"/>
                    <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" className="fill-purple-300"/>
                  </svg>
                ),
                color: "purple"
              },
              {
                step: "03",
                title: "Connect & Run",
                description: "Authorize your tools once with OAuth, then run on demand or schedule automatically.",
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" className="fill-pink-400"/>
                  </svg>
                ),
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
                          <ArrowRightIcon />
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
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" className="fill-blue-400"/>
                    <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" className="fill-blue-300"/>
                  </svg>
                ),
                title: "No Code Required",
                description: "Just describe what you want in natural language. No programming, no complex workflows.",
                color: "blue"
              },
              {
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0 11.5 11.5 0 010 16.268.75.75 0 11-1.06-1.06 10 10 0 000-14.147.75.75 0 010-1.061zM15.932 7.757a.75.75 0 011.061 0 7.5 7.5 0 010 10.606.75.75 0 01-1.06-1.06 6 6 0 000-8.486.75.75 0 010-1.06z" className="fill-purple-400"/>
                  </svg>
                ),
                title: "Works With Your Tools",
                description: "Connect Gmail, Notion, Slack, Drive, Calendar, and more. We integrate with the apps you love.",
                color: "purple"
              },
              {
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-16.5 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-13.5h9.75a3 3 0 013 3v6a3 3 0 01-3 3H6.75a3 3 0 01-3-3v-6a3 3 0 013-3z" className="fill-pink-400"/>
                  </svg>
                ),
                title: "Smart Agent Builder",
                description: "Our AI understands context and builds sophisticated automations from simple descriptions.",
                color: "pink"
              },
              {
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" className="fill-green-400"/>
                  </svg>
                ),
                title: "Run or Schedule",
                description: "Execute agents on demand or set them to run automatically on your schedule.",
                color: "green"
              },
              {
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" className="fill-blue-400"/>
                  </svg>
                ),
                title: "Secure OAuth",
                description: "Industry-standard OAuth connections keep your data safe. We never store your passwords.",
                color: "blue"
              },
              {
                icon: (
                  <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
                    <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" className="fill-purple-400"/>
                  </svg>
                ),
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
                  <CheckIcon />
                  <span>Free during beta</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckIcon />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckIcon />
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