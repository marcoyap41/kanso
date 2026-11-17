'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { api, setStoredToken } from '@/lib/api';
import type { User } from '@/types/kanso';
import { AmbientBackdrop } from './AmbientBackdrop';
import { KansoLogo } from './KansoLogo';

interface AuthScreenProps {
  onAuthenticated: (user: User) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password);
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickDemo() {
    setError(null);
    setLoading(true);
    const demoUser = 'zenuser';
    const demoPass = 'kanso1234';
    try {
      const res = await api.login(demoUser, demoPass);
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch {
      try {
        const res = await api.register(demoUser, demoPass);
        setStoredToken(res.token);
        onAuthenticated(res.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Demo login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#0A0A0C] text-white flex flex-col">
      <AmbientBackdrop />

      {/* Minimal Header */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-6">
        <KansoLogo />
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#141418]/80 px-4 py-1.5 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>simplicity in execution</span>
        </div>
      </header>

      {/* Center Hero + Auth Card */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md text-center"
        >
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 mb-4">
            kanso workspace
          </p>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-[-0.04em] leading-[1.03] text-white mb-4">
            Big picture.
            <br />
            Small steps.
          </h1>
          <p className="text-sm sm:text-base text-zinc-400 mb-8 max-w-sm mx-auto leading-relaxed">
            Organize up to 5 boards, break work into micro-steps, and execute one
            focused session at a time.
          </p>

          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border border-white/10 bg-[#121216]/90 backdrop-blur-xl p-6 sm:p-7 text-left shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
          >
            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-1 rounded-full bg-[#0A0A0C] p-1 border border-white/[0.06] mb-5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`rounded-full py-2 text-xs font-semibold transition ${
                  mode === 'login'
                    ? 'bg-white text-[#0A0A0C]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`rounded-full py-2 text-xs font-semibold transition ${
                  mode === 'register'
                    ? 'bg-white text-[#0A0A0C]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Create account
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. kenji"
                  className="w-full rounded-2xl border border-white/10 bg-[#0A0A0C] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-2xl border border-white/10 bg-[#0A0A0C] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none transition"
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 disabled:opacity-50 py-3 px-6 text-sm font-semibold shadow-[0_0_30px_rgba(255,255,255,0.14)] transition"
              >
                <span>
                  {loading
                    ? 'Preparing workspace...'
                    : mode === 'login'
                      ? 'Enter kanso'
                      : 'Create workspace'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={handleQuickDemo}
                className="w-full flex items-center justify-center gap-2 rounded-full bg-[#18181D] hover:bg-[#222229] text-zinc-200 border border-white/10 hover:border-white/20 py-2.5 px-5 text-xs font-medium transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                <span>Quick Demo Login (with College starter board)</span>
              </button>
            </div>
          </form>
        </motion.div>
      </main>
    </div>
  );
}
