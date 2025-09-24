'use client';

import React from 'react';
import { useOnboarding } from './hooks/useOnboarding';
import ProfileStep from './ProfileStep';
import PluginsStep from './PluginsStep';
import RoleStep from './RoleStep';

const Onboarding: React.FC = () => {
  const {
    currentStep,
    data,
    isLoading,
    error,
    isInitialized,
    nextStep,
    prevStep,
    updateProfile,
    updateRole,
    canProceedToNext,
    completeOnboarding,
    getStepTitle,
    getProgress,
    isFirstStep,
    isLastStep,
  } = useOnboarding();

  // Show loading spinner while initializing
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-100 flex items-center justify-center">
        <div className="text-center">
          <div className="relative mb-8">
            <div className="w-20 h-20 border-4 border-slate-200 rounded-full animate-spin border-t-blue-500 mx-auto"></div>
            <div className="absolute inset-0 w-20 h-20 border-4 border-transparent rounded-full animate-ping border-t-blue-300 mx-auto opacity-75"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white text-lg">⚡</span>
              </div>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-slate-700 mb-2">Setting up your workspace</h2>
          <p className="text-slate-500">This will just take a moment...</p>
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
        return <PluginsStep data={[]} onChange={() => {}} />;
      case 2:
        return <RoleStep data={data.role} onChange={updateRole} />;
      default:
        return null;
    }
  };

  const stepIcons = [
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>,
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>,
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-100 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute top-40 right-20 w-72 h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-20 left-40 w-72 h-72 bg-indigo-400 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
        
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 25px 25px, rgba(99, 102, 241, 0.15) 2px, transparent 0)`,
            backgroundSize: '50px 50px'
          }}></div>
        </div>
      </div>

      <div className="relative sm:mx-auto sm:w-full sm:max-w-2xl">
        {/* Compact Header */}
        <div className="text-center mb-8">
          <div className="relative inline-flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 rounded-2xl shadow-lg shadow-blue-500/25 flex items-center justify-center">
              <div className="w-12 h-12 bg-white/10 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
          </div>
          
          <h1 className="text-3xl font-bold mb-2">
            <span className="bg-gradient-to-r from-slate-800 via-blue-700 to-indigo-700 bg-clip-text text-transparent">
              Welcome to AgentsPilot
            </span>
          </h1>
          
          <p className="text-slate-600 max-w-md mx-auto">
            Let's get you set up quickly and efficiently.
          </p>
        </div>

        {/* Compact Step Indicators */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-6 mb-4">
            {[0, 1, 2].map((step) => (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center">
                  {/* Step Circle */}
                  <div className={`relative flex items-center justify-center w-12 h-12 rounded-full text-sm font-semibold transition-all duration-500 ${
                    step === currentStep 
                      ? 'bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 text-white shadow-lg shadow-blue-500/25 scale-105' 
                      : step < currentStep 
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md shadow-green-500/20 scale-100'
                        : 'bg-slate-200 text-slate-500 shadow-sm'
                  }`}>
                    {step < currentStep ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      stepIcons[step]
                    )}
                  </div>
                  
                  {/* Step Label */}
                  <div className="mt-2 text-center">
                    <div className={`text-xs font-medium transition-colors duration-300 ${
                      step === currentStep ? 'text-blue-700' : step < currentStep ? 'text-green-700' : 'text-slate-500'
                    }`}>
                      {['Profile', 'Plugins', 'Role'][step]}
                    </div>
                  </div>
                </div>
                
                {/* Connection Line */}
                {step < 2 && (
                  <div className={`h-0.5 w-16 rounded-full transition-all duration-500 ${
                    step < currentStep ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-slate-200'
                  }`}>
                    {step + 1 === currentStep && (
                      <div className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full"></div>
                    )}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
          
          {/* Progress Stats */}
          <div className="text-center">
            <div className="inline-flex items-center space-x-3 px-4 py-2 bg-white/50 backdrop-blur-sm rounded-xl border border-white/30 shadow-sm">
              <span className="text-xs font-medium text-slate-700">
                Step {currentStep + 1} of 3
              </span>
              <div className="w-px h-3 bg-slate-300"></div>
              <span className="text-xs font-medium text-slate-700">
                {Math.round(getProgress())}% Complete
              </span>
            </div>
          </div>
        </div>

        {/* Compact Main Card */}
        <div className="relative group">
          {/* Card Background with Glassmorphism */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-white/60 to-white/40 backdrop-blur-xl rounded-2xl border border-white/30 shadow-xl shadow-slate-900/5"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 rounded-2xl"></div>
          
          <div className="relative bg-transparent py-8 px-6 sm:px-8">
            {/* Compact Step Title */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">
                {getStepTitle()}
              </h2>
              
              <div className="w-16 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full mx-auto"></div>
            </div>

            {/* Compact Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-rose-50 border border-red-200/50 rounded-xl shadow-sm">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 bg-red-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-red-900 mb-1">Something went wrong</h3>
                    <p className="text-red-700 text-xs">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Step Content */}
            <div className="mb-8">
              <div className="transform transition-all duration-500 ease-out">
                {renderCurrentStep()}
              </div>
            </div>

            {/* Compact Navigation Buttons */}
            <div className="flex items-center justify-between space-x-4">
              <button
                type="button"
                onClick={prevStep}
                disabled={isFirstStep}
                className={`group flex items-center space-x-2 px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                  isFirstStep
                    ? 'text-slate-400 cursor-not-allowed bg-slate-100 opacity-50'
                    : 'text-slate-700 bg-white/70 backdrop-blur-sm border border-slate-200 hover:bg-white hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'
                }`}
              >
                <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Previous</span>
              </button>

              <button
                type="button"
                onClick={handleNext}
                disabled={!canProceedToNext() || isLoading}
                className={`group relative flex items-center space-x-2 px-8 py-3 text-sm font-semibold text-white rounded-xl transition-all duration-200 overflow-hidden ${
                  canProceedToNext() && !isLoading
                    ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0'
                    : 'bg-slate-300 cursor-not-allowed opacity-50'
                }`}
              >
                <div className="relative flex items-center space-x-2">
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {isLastStep ? 'Complete Setup' : 'Continue'}
                      </span>
                      <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Compact Footer */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center space-x-4 px-6 py-3 bg-white/30 backdrop-blur-sm rounded-xl border border-white/20 shadow-sm">
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span className="text-sm text-slate-700">Need help?</span>
            </div>
            
            <a 
              href="mailto:support@neuronforge.com" 
              className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors duration-200 hover:underline"
            >
              Contact Support
            </a>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
};

export default Onboarding;