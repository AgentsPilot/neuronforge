'use client';

import React, { useState, useEffect } from 'react';
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
    const handleMouseMove = (e) => {
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
      <div className="min-h-screen relative text-white overflow-hidden">
        {/* EXACT SAME background as main onboarding */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
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

          {/* Interactive mouse glow */}
          <div 
            className="absolute inset-0 pointer-events-none transition-all duration-500"
            style={{
              background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(139, 92, 246, 0.15), transparent 60%)`
            }}
          />
        </div>

        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="relative mb-8">
              {/* Modern loading animation */}
              <div className="w-12 h-12 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-gray-700"></div>
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin"></div>
                <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-purple-400 animate-spin" style={{ animationDuration: '0.8s', animationDirection: 'reverse' }}></div>
              </div>
            </div>
            <h2 className="text-xl font-medium text-gray-100 mb-2">Initializing workspace</h2>
            <p className="text-gray-400 text-sm">Setting up your environment...</p>
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
    <div className="min-h-screen relative text-white overflow-hidden">
      {/* Website-style animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
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

      <div className="relative z-10 flex min-h-screen">
        {/* Left sidebar - Progress */}
        <div className="hidden lg:flex w-80 flex-col justify-center p-12 border-r border-gray-800/50">
          <div className="space-y-8">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-xl font-semibold text-white">AgentsPilot</span>
            </div>

            {/* Progress steps */}
            <div className="space-y-6">
              <h2 className="text-lg font-medium text-gray-200">Setup Progress</h2>
              <div className="space-y-4">
                {stepLabels.map((label, index) => (
                  <div key={index} className="flex items-center space-x-4">
                    {/* Step indicator */}
                    <div className={`relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all duration-300 ${
                      index === currentStep
                        ? 'border-blue-400 bg-blue-500/20 shadow-lg shadow-blue-500/25'
                        : index < currentStep
                        ? 'border-green-400 bg-green-500/20'
                        : 'border-gray-600 bg-gray-800/50'
                    }`}>
                      {index < currentStep ? (
                        <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span className={`text-sm font-medium ${
                          index === currentStep ? 'text-blue-400' : 'text-gray-400'
                        }`}>
                          {index + 1}
                        </span>
                      )}
                    </div>

                    {/* Step label */}
                    <div className="flex-1">
                      <div className={`font-medium transition-colors ${
                        index === currentStep
                          ? 'text-blue-300'
                          : index < currentStep
                          ? 'text-green-300'
                          : 'text-gray-400'
                      }`}>
                        {label}
                      </div>
                      {index === currentStep && (
                        <div className="text-xs text-gray-500 mt-0.5">Current step</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Progress</span>
                  <span className="text-blue-400 font-medium">{Math.round(getProgress())}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${getProgress()}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Help section */}
            <div className="p-4 bg-gray-800/30 rounded-xl border border-gray-700/50">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-gray-700/50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-200 mb-1">Need assistance?</h4>
                  <p className="text-xs text-gray-400 mb-2">Our team is here to help you get started</p>
                  <a href="mailto:support@agentspilot.com" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
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
            <div className="lg:hidden mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <span className="text-lg font-semibold text-white">AgentsPilot</span>
                </div>
                <div className="text-sm text-gray-400">
                  {currentStep + 1} of {stepLabels.length}
                </div>
              </div>
              
              {/* Mobile progress bar */}
              <div className="w-full bg-gray-800 rounded-full h-1">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-purple-500 h-1 rounded-full transition-all duration-500"
                  style={{ width: `${getProgress()}%` }}
                ></div>
              </div>
            </div>

            {/* Main card */}
            <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800/50 rounded-2xl shadow-2xl">
              {/* Header */}
              <div className="p-8 pb-6 border-b border-gray-800/50">
                <h1 className="text-2xl font-semibold text-white mb-2">
                  {getStepTitle()}
                </h1>
                <p className="text-gray-400 text-sm">
                  Step {currentStep + 1} of {stepLabels.length}
                </p>
              </div>

              {/* Content */}
              <div className="p-8">
                {/* Error message */}
                {error && (
                  <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-5 h-5 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-red-300 mb-1">Setup Error</h4>
                        <p className="text-xs text-red-400">{error}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step content */}
                <div className="space-y-6">
                  {renderCurrentStep()}
                </div>
              </div>

              {/* Footer */}
              <div className="p-8 pt-6 border-t border-gray-800/50">
                <div className="flex items-center justify-between">
                  <button
                    onClick={prevStep}
                    disabled={isFirstStep}
                    className={`flex items-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                      isFirstStep
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'text-gray-300 hover:text-white hover:bg-gray-800/50 active:scale-95'
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
                    className={`relative flex items-center space-x-2 px-6 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                      canProceedToNext() && !isLoading
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 active:scale-95'
                        : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"></div>
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

            {/* Security notice */}
            <div className="mt-6 text-center">
              <p className="text-xs text-gray-500">
                Your data is encrypted and secure. We never share your information.
              </p>
            </div>
          </div>
        </div>
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
  );
};

export default Onboarding;