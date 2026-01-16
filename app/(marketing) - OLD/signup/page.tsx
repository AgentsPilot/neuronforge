'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailCheckLoading, setEmailCheckLoading] = useState(false);
  const emailCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleGoogleSignUp = async () => {
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
      setErrorMessage('Failed to sign up with Google. Please try again.');
      setIsLoading(false);
    }
  };

  // Check if email already exists
  const checkEmailExists = async (emailToCheck: string) => {
    if (!emailToCheck.trim()) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailToCheck)) return;

    setEmailCheckLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/check-user-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToCheck })
      });

      if (response.ok) {
        const { exists, onboardingCompleted } = await response.json();

        if (exists) {
          if (onboardingCompleted === true) {
            setErrorMessage('This email is already registered and the account is active. Please login instead.');
          } else if (onboardingCompleted === false) {
            setErrorMessage('This email is already registered. Please login to complete your account setup.');
          } else {
            setErrorMessage('This email is already registered. Please check your email for the confirmation link.');
          }
        }
      }
    } catch (error) {
      console.error('Error checking email:', error);
    } finally {
      setEmailCheckLoading(false);
    }
  };

  // Detect autofill and validate email after a short delay
  useEffect(() => {
    // Clear any existing timeout
    if (emailCheckTimeoutRef.current) {
      clearTimeout(emailCheckTimeoutRef.current);
    }

    // If email is empty, clear errors
    if (!email.trim()) {
      setErrorMessage('');
      return;
    }

    // Validate after 500ms of no changes
    emailCheckTimeoutRef.current = setTimeout(() => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      // Check if email contains @ (user started typing email)
      if (email.includes('@')) {
        // If format is invalid, show format error
        if (!emailRegex.test(email)) {
          setErrorMessage('Please enter a valid email address');
        } else {
          // Format is valid, check if email exists in database
          checkEmailExists(email);
        }
      }
    }, 500);

    // Cleanup timeout on unmount
    return () => {
      if (emailCheckTimeoutRef.current) {
        clearTimeout(emailCheckTimeoutRef.current);
      }
    };
  }, [email]);

  // Also check on blur for immediate feedback
  const handleEmailBlur = async () => {
    await checkEmailExists(email);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsLoading(true);

    // Custom validation with friendly messages
    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name to continue');
      setIsLoading(false);
      return;
    }

    if (!email.trim()) {
      setErrorMessage('Please enter your email address to continue');
      setIsLoading(false);
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setErrorMessage('Please enter a valid email address');
      setIsLoading(false);
      return;
    }

    if (!password) {
      setErrorMessage('Please create a password to secure your account');
      setIsLoading(false);
      return;
    }

    if (!confirmPassword) {
      setErrorMessage('Please confirm your password');
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      setIsLoading(false);
      return;
    }

    try {
      // Sign up the user with metadata only (no profile creation yet)
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            onboarding_completed: false, // Track onboarding status in metadata
          },
          emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/auth/callback`,
        },
      });

      if (error) {

        // Check if user already exists
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          // Check onboarding status to provide specific message
          try {
            // Try to get profile by email (need to have email column in profiles or use auth.users view)
            // Since we can't access auth.users from client, we'll check via an API endpoint
            const response = await fetch('/api/check-user-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email })
            });

            if (response.ok) {
              const { onboardingCompleted } = await response.json();

              if (onboardingCompleted === true) {
                setErrorMessage('This email is already registered and the account is active. Please login instead.');
              } else if (onboardingCompleted === false) {
                setErrorMessage('This email is already registered. Please login to complete your account setup.');
              } else {
                setErrorMessage('This email is already registered. Please login instead.');
              }
            } else {
              setErrorMessage('This email is already registered. Please login instead.');
            }
          } catch (profileError) {
            console.error('Error checking user profile:', profileError);
            setErrorMessage('This email is already registered. Please login instead.');
          }
        } else if (error.message.includes('Email rate limit exceeded')) {
          setErrorMessage('Too many signup attempts. Please try again in a few minutes.');
        } else if (error.message.includes('Invalid email')) {
          setErrorMessage('Please enter a valid email address.');
        } else if (error.message.toLowerCase().includes('password')) {
          setErrorMessage('Password must be at least 6 characters long.');
        } else {
          // User-friendly generic error with actual message
          setErrorMessage(`Signup failed: ${error.message}. Please try again or contact support.`);
        }
        setIsLoading(false);
        return;
      }

      const user = data?.user;
      const session = data?.session;

      // Supabase returns user even for existing emails when confirmation is required
      // Check if this is actually a new signup or existing user
      if (!user) {
        setErrorMessage('Signup failed. Please try again.');
        setIsLoading(false);
        return;
      }

      // When email confirmation is enabled and user already exists:
      // - Supabase returns the user object
      // - But identities array will be empty (no new identity was created)
      // - And there's no session
      const hasIdentities = user.identities && user.identities.length > 0;

      if (!hasIdentities && !session) {
        // Existing user trying to sign up again (no new identity created)
        // The user.id from signup response is NOT the real user ID when user already exists
        // We need to check by email using our API endpoint
        try {
          const response = await fetch('/api/check-user-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });

          if (response.ok) {
            const { exists, onboardingCompleted } = await response.json();

            if (!exists) {
              // User doesn't exist - this shouldn't happen but handle gracefully
              setErrorMessage('A confirmation email was already sent to this address. Please check your email or wait a few minutes to try again.');
            } else if (onboardingCompleted === true) {
              // User completed onboarding - account is active
              setErrorMessage('This email is already registered and the account is active. Please login instead.');
            } else if (onboardingCompleted === false) {
              // Profile exists but onboarding not completed
              setErrorMessage('This email is already registered. Please login to complete your account setup.');
            } else {
              // Profile doesn't exist - user signed up but never confirmed email
              setErrorMessage('A confirmation email was already sent to this address. Please check your email or wait a few minutes to try again.');
            }
          } else {
            console.error('Failed to check user status');
            setErrorMessage('This email is already registered. Please login instead.');
          }
        } catch (error) {
          console.error('Error checking user status:', error);
          setErrorMessage('This email is already registered. Please login instead.');
        }

        setIsLoading(false);
        return;
      }

      // Handle success based on whether email confirmation is required
      if (!session) {
        // Email confirmation required - redirect to home page
        setSuccessMessage(
          'Signup successful! Please check your email to confirm your account.'
        );
        setTimeout(() => router.push('/'), 2000);
      } else {
        // Email confirmation disabled - redirect to onboarding
        setSuccessMessage('Account created successfully! Redirecting to setup...');
        setTimeout(() => router.push('/onboarding'), 1500);
      }
    } catch (error) {
      console.error('Unexpected signup error:', error);
      const errorMsg = error instanceof Error ? error.message : 'An unexpected error occurred';
      setErrorMessage(`${errorMsg}. Please try again or contact support.`);
    } finally {
      setIsLoading(false);
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
                Create Your Account
              </span>
              <span className="text-white block">
                Join the AI Workforce
              </span>
            </h1>
            <p className="text-base md:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Start building intelligent agents in minutes. No credit card required.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Two-Column Signup Section */}
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
                  Why AgentsPilot?
                </h2>
                <p className="text-base md:text-lg text-slate-300 leading-relaxed">
                  Transform natural language into intelligent agents that automate your work across all your tools.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-orange-500/20 border border-orange-400/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Instant Setup</h3>
                    <p className="text-slate-400">Create your first agent in under 2 minutes. No technical knowledge required.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Enterprise Security</h3>
                    <p className="text-slate-400">Bank-level encryption and SOC 2 compliance to keep your data safe.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-green-500/20 border border-green-400/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Free Trial Included</h3>
                    <p className="text-slate-400">10,417 free Pilot Credits to get started. No credit card needed.</p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800">
                <h3 className="text-lg font-bold text-white mb-3">What You Get</h3>
                <ul className="space-y-2">
                  {[
                    '10,417 free Pilot Credits',
                    'All integrations included',
                    'Flexible credit-based pricing',
                    'Cancel anytime'
                  ].map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-slate-300">
                      <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>

            {/* Right Column - Signup Form */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 p-6 md:p-8 h-full">
              <form onSubmit={handleSignup} className="space-y-4">

                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-500/10 border border-red-500/30 p-4"
                  >
                    <p className="text-red-300 text-sm">{errorMessage}</p>
                  </motion.div>
                )}
                {successMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-green-500/10 border border-green-500/30 p-4"
                  >
                    <p className="text-green-300 text-sm">{successMessage}</p>
                  </motion.div>
                )}

                {/* Full Name */}
                <div className="space-y-1.5">
                  <label htmlFor="fullName" className="text-sm font-bold text-slate-200 block">
                    Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    placeholder="Enter your full name"
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={isLoading}
                    autoFocus
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-bold text-slate-200 block">
                    Email Address <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setErrorMessage(''); // Clear error when user types
                      }}
                      onBlur={handleEmailBlur}
                      disabled={isLoading || emailCheckLoading}
                    />
                    {emailCheckLoading && (
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-sm font-bold text-slate-200 block">
                    Password <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200 pr-12"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-4 flex items-center"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      <svg
                        className="w-5 h-5 text-slate-400 hover:text-white transition-colors"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        {showPassword ? (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                          />
                        ) : (
                          <>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label htmlFor="confirmPassword" className="text-sm font-bold text-slate-200 block">
                    Confirm Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter your password"
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isLoading}
                  />
                </div>

                {/* Signup Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-bold py-3 px-4 transition-all duration-200 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Creating Account...' : 'Sign Up'}
                </button>

                {/* Divider */}
                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-white/10"></div>
                  <span className="flex-shrink mx-4 text-slate-400 text-sm">or continue with</span>
                  <div className="flex-grow border-t border-white/10"></div>
                </div>

                {/* Google Sign Up Button */}
                <button
                  type="button"
                  onClick={handleGoogleSignUp}
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
                  Sign up with Google
                </button>

                {/* OAuth Info */}
                <div className="text-center">
                  <p className="text-xs text-slate-500">
                    By signing up with Google, you agree to our terms. If you already have an account, you'll be signed in.
                  </p>
                </div>
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
              Already have an account?{' '}
              <Link href="/login" className="text-orange-400 hover:text-orange-300 font-bold transition-colors">
                Sign in here
              </Link>
            </p>
            <p className="text-slate-500 text-xs">
              By creating an account, you agree to our{' '}
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
    </>
  );
}
