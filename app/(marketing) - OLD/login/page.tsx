'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Lock, Mail, Shield, Zap } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password states
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [forgotError, setForgotError] = useState('');

  const handleGoogleSignIn = async () => {
    setErrorMessage('');
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        }
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
      }
      // If successful, user will be redirected to Google OAuth flow
    } catch (error) {
      setErrorMessage('Failed to sign in with Google. Please try again.');
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoading(true);

    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        setErrorMessage(loginError.message);

        // AUDIT TRAIL: Log failed login attempt
        try {
          await fetch('/api/audit/log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': 'anonymous' // No user ID for failed login
            },
            body: JSON.stringify({
              action: 'USER_LOGIN_FAILED',
              entityType: 'user',
              entityId: null,
              userId: null,
              resourceName: email,
              details: {
                email,
                error: loginError.message,
                timestamp: new Date().toISOString()
              },
              severity: 'warning',
              complianceFlags: ['SOC2']
            })
          });
        } catch (auditError) {
          console.error('Audit logging failed (non-critical):', auditError);
        }
      } else {
        // AUDIT TRAIL: Log successful login
        try {
          await fetch('/api/audit/log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': data.user?.id || ''
            },
            body: JSON.stringify({
              action: 'USER_LOGIN',
              entityType: 'user',
              entityId: data.user?.id,
              userId: data.user?.id,
              resourceName: data.user?.email || email,
              details: {
                email: data.user?.email,
                timestamp: new Date().toISOString(),
                login_method: 'password'
              },
              severity: 'info',
              complianceFlags: ['SOC2']
            })
          });
        } catch (auditError) {
          console.error('Audit logging failed (non-critical):', auditError);
        }

        // Check onboarding status and redirect accordingly
        const user = data.user;
        const onboardingCompleted = user?.user_metadata?.onboarding_completed;

        if (onboardingCompleted === false || onboardingCompleted === undefined) {
          // User hasn't completed onboarding
          console.log('User needs to complete onboarding, redirecting...');
          router.push('/onboarding');
        } else {
          // Onboarding complete - go to dashboard
          console.log('Login successful, redirecting to dashboard...');
          router.push('/dashboard');
        }
      }
    } catch (error) {
      setErrorMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotSuccess('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setForgotError(error.message);
      } else {
        setForgotSuccess('Password reset link sent to your email.');
        setTimeout(() => {
          setIsForgotOpen(false);
          setForgotEmail('');
          setForgotSuccess('');
        }, 2000);
      }
    } catch {
      setForgotError('Something went wrong. Please try again.');
    }
  };

  return (
    <>
      {/* Header Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center space-y-4"
          >
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-black leading-tight">
              <span className="text-orange-400 block">
                Welcome Back
              </span>
              <span className="text-white block">
                Sign In to Continue
              </span>
            </h1>
            <p className="text-base md:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Access your AI agents and continue automating your workflows.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Two-Column Login Section */}
      <section className="relative py-24 md:py-32 px-4 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
            {/* Left Column - Information */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
              <div>
                <h2 className="text-2xl md:text-3xl font-black text-white mb-4">
                  Continue Your Journey
                </h2>
                <p className="text-base md:text-lg text-slate-300 leading-relaxed">
                  Sign in to access your AI agents, manage your workflows, and continue building the future of automation.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-orange-500/20 border border-orange-400/30 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Instant Access</h3>
                    <p className="text-slate-400">Jump right back into your agents and workflows. Everything is exactly where you left it.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-purple-500/20 border border-purple-400/30 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Secure & Private</h3>
                    <p className="text-slate-400">Your data is encrypted and protected with enterprise-grade security measures.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
                    <Lock className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">SOC2 Compliant</h3>
                    <p className="text-slate-400">Full audit trails and compliance tracking for your organization.</p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800">
                <h3 className="text-lg font-bold text-white mb-3">Your Dashboard Includes</h3>
                <ul className="space-y-2">
                  {[
                    'All your active agents',
                    'Execution history and logs',
                    'Credit usage and billing',
                    'Plugin configurations'
                  ].map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-slate-300">
                      <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>

            {/* Right Column - Login Form */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 p-6 md:p-8 h-full">
                <h3 className="text-xl font-bold text-white mb-6">Sign In to Your Account</h3>

                <form onSubmit={handleLogin} className="space-y-6">
                  {/* Error Message */}
                  {errorMessage && (
                    <div className="bg-red-500/10 border border-red-500/30 p-3">
                      <p className="text-red-300 text-sm">{errorMessage}</p>
                    </div>
                  )}

                  {/* Email Input */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-slate-300 block">
                      Email Address *
                    </label>
                    <input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>

                  {/* Password Input */}
                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium text-slate-300 block">
                      Password *
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200 pr-12"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 pr-4 flex items-center"
                        onClick={() => setShowPassword(!showPassword)}
                        disabled={isLoading}
                      >
                        <svg className="w-5 h-5 text-slate-400 hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {showPassword ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                          ) : (
                            <>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </>
                          )}
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Forgot Password Link */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setIsForgotOpen(true)}
                      className="text-sm text-slate-400 hover:text-orange-400 transition-colors duration-200"
                    >
                      Forgot your password?
                    </button>
                  </div>

                  {/* Sign In Button */}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-white py-4 px-6 transition-all duration-300 hover:shadow-lg hover:shadow-orange-500/25 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Signing In...
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Sign In
                      </>
                    )}
                  </button>

                  {/* Divider */}
                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-zinc-800"></div>
                    <span className="flex-shrink mx-4 text-slate-400 text-sm">or continue with</span>
                    <div className="flex-grow border-t border-zinc-800"></div>
                  </div>

                  {/* Google Sign In Button */}
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-white font-semibold py-3 px-4 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-3"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    Continue with Google
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Footer Info Section */}
      <section className="relative py-12 px-4 bg-zinc-950 border-t border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="text-center space-y-4">
            <p className="text-slate-400 text-sm">
              Don't have an account?{' '}
              <Link href="/signup" className="text-orange-400 hover:text-orange-300 font-bold transition-colors">
                Sign up here
              </Link>
            </p>
            <p className="text-slate-500 text-xs">
              By signing in, you agree to our{' '}
              <Link href="/terms" className="text-slate-400 hover:text-white transition-colors">
                Terms of Service
              </Link>
              {' '}and{' '}
              <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Forgot Password Modal */}
      {isForgotOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 px-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-md w-full"
          >
            <div className="bg-zinc-900 border border-zinc-800 p-6">
              <h2 className="text-2xl font-bold text-white mb-6">Reset Password</h2>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
                {forgotSuccess && (
                  <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 p-3">
                    {forgotSuccess}
                  </p>
                )}
                {forgotError && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 p-3">
                    {forgotError}
                  </p>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsForgotOpen(false)}
                    className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-all shadow-lg hover:shadow-xl"
                  >
                    Send Link
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
