'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useOnboarding } from './hooks/useOnboarding';
import ProfileStep from './ProfileStep';
import DomainStep from './DomainStep';
import PluginsStep from './PluginsStep';
import RoleStep from './RoleStep';

const Onboarding: React.FC = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const {
    currentStep,
    data,
    isLoading,
    error,
    isInitialized,
    nextStep,
    prevStep,
    updateProfile,
    updateDomain,
    updateRole,
    canProceedToNext,
    completeOnboarding,
    getStepTitle,
    getProgress,
    isFirstStep,
    isLastStep,
  } = useOnboarding();

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Show loading spinner while initializing
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-black text-white overflow-hidden">
        {/* Background Effects - Matching Landing Page */}
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
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="relative mb-8">
              {/* Modern loading animation */}
              <div className="w-12 h-12 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-slate-800"></div>
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin"></div>
                <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-purple-400 animate-spin" style={{ animationDuration: '0.8s', animationDirection: 'reverse' }}></div>
              </div>
            </div>
            <h2 className="text-xl font-medium bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">Initializing workspace</h2>
            <p className="text-slate-400 text-sm">Setting up your environment...</p>
          </div>
        </div>
      </div>
    );
  }

  const handleNext = async () => {
    if (isLastStep) {
      const success = await completeOnboarding();
      if (success) {
        window.location.href = '/dashboard';
      }
    } else {
      nextStep();
    }
  };

  const renderCurrentStep = () => {    
    switch (currentStep) {
      case 0:
        return <ProfileStep data={data.profile} onChange={updateProfile} />;
      case 1:
        return <DomainStep data={data.domain} onChange={updateDomain} />;
      case 2:
        return <PluginsStep data={[]} onChange={() => {}} />;
      case 3:
        return <RoleStep data={data.role} onChange={updateRole} />;
      default:
        return null;
    }
  };

  const stepLabels = ['Profile', 'Domain', 'Integrations', 'Role'];

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Background Effects - Matching Landing Page */}
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
      </div>

      <div className="relative z-10 flex min-h-screen">
        {/* Left sidebar - Progress */}
        <div className="hidden lg:flex w-80 flex-col justify-center p-12 border-r border-white/10 backdrop-blur-xl bg-slate-900/20">
          <div className="space-y-8">
            {/* Logo */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="flex items-center space-x-3"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-2xl">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">AgentsPilot</span>
            </motion.div>

            {/* Progress steps */}
            <div className="space-y-6">
              <h2 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Setup Progress</h2>
              <div className="space-y-4">
                {stepLabels.map((label, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="flex items-center space-x-4"
                  >
                    {/* Step indicator */}
                    <div className={`relative flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all duration-300 ${
                      index === currentStep
                        ? 'border-purple-400 bg-purple-500/20 shadow-lg shadow-purple-500/30'
                        : index < currentStep
                        ? 'border-green-400 bg-green-500/20 shadow-sm shadow-green-500/20'
                        : 'border-slate-600 bg-slate-800/50'
                    }`}>
                      {index < currentStep ? (
                        <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span className={`text-sm font-bold ${
                          index === currentStep ? 'text-purple-400' : 'text-slate-500'
                        }`}>
                          {index + 1}
                        </span>
                      )}
                    </div>

                    {/* Step label */}
                    <div className="flex-1">
                      <div className={`font-semibold transition-colors ${
                        index === currentStep
                          ? 'text-purple-300'
                          : index < currentStep
                          ? 'text-green-300'
                          : 'text-slate-500'
                      }`}>
                        {label}
                      </div>
                      {index === currentStep && (
                        <div className="text-xs text-slate-500 mt-0.5">Current step</div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Progress</span>
                  <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent font-bold">{Math.round(getProgress())}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${getProgress()}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 h-2 rounded-full shadow-lg shadow-purple-500/50"
                  ></motion.div>
                </div>
              </div>
            </div>

            {/* Help section */}
            <div className="p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-200 mb-1">Need assistance?</h4>
                  <p className="text-xs text-slate-400 mb-2">Our team is here to help you get started</p>
                  <a href="mailto:support@agentspilot.com" className="text-xs bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent hover:from-blue-300 hover:to-purple-300 transition-all duration-200 font-medium">
                    Contact support
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg">
            {/* Mobile progress indicator */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="lg:hidden mb-8"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-2xl">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <span className="text-lg font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">AgentsPilot</span>
                </div>
                <div className="text-sm text-slate-400">
                  {currentStep + 1} of {stepLabels.length}
                </div>
              </div>

              {/* Mobile progress bar */}
              <div className="w-full bg-slate-800 rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${getProgress()}%` }}
                ></div>
              </div>
            </motion.div>

            {/* Main card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative group"
            >
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl opacity-50 group-hover:opacity-75 blur-lg transition duration-500"></div>
              <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl">
                {/* Header */}
                <div className="p-8 pb-6 border-b border-white/10">
                  <h1 className="text-3xl font-bold mb-2">
                    <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                      {getStepTitle()}
                    </span>
                  </h1>
                  <p className="text-slate-400 text-sm">
                    Step {currentStep + 1} of {stepLabels.length}
                  </p>
                </div>

              {/* Content */}
              <div className="p-8">
                {/* Error message */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-red-300 mb-1">Setup Error</h4>
                        <p className="text-xs text-red-400">{error}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Step content */}
                <div className="space-y-6">
                  {renderCurrentStep()}
                </div>
              </div>

              {/* Footer */}
              <div className="p-8 pt-6 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <button
                    onClick={prevStep}
                    disabled={isFirstStep}
                    className={`flex items-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                      isFirstStep
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'text-slate-300 hover:text-white hover:bg-white/5 active:scale-95'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>Back</span>
                  </button>

                  <button
                    onClick={handleNext}
                    disabled={!canProceedToNext() || isLoading}
                    className={`relative flex items-center space-x-2 px-6 py-3 text-sm font-bold rounded-xl transition-all duration-200 ${
                      canProceedToNext() && !isLoading
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg shadow-purple-500/50 hover:shadow-purple-500/75 active:scale-95'
                        : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <span>{isLastStep ? 'Complete Setup' : 'Continue'}</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
            </motion.div>

            {/* Security notice */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mt-6 text-center"
            >
              <p className="text-xs text-slate-500">
                Your data is encrypted and secure. We never share your information.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;