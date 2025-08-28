'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) setError(error.message);
    else {
      setMessage('Password updated successfully');
      setTimeout(() => router.push('/login'), 2000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <form onSubmit={handleReset} className="bg-white/10 p-6 rounded-xl space-y-4 w-full max-w-md">
        <h1 className="text-xl font-semibold">Reset Your Password</h1>
        <input
          type="password"
          placeholder="New password"
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Confirm password"
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {message && <p className="text-green-400">{message}</p>}
        {error && <p className="text-red-400">{error}</p>}
        <button type="submit" className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 transition">
          Update Password
        </button>
      </form>
    </div>
  );
}