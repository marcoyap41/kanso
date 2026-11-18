'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';
import { api, type ApiRequestError } from '@/lib/api';
import type { User } from '@/types/kanso';
import { AmbientBackdrop } from './AmbientBackdrop';
import { KansoLogo } from './KansoLogo';

interface AuthScreenProps {
  onAuthenticated: (user: User) => void;
  initialError?: string | null;
  onClearInitialError?: () => void;
}

export function AuthScreen({
  onAuthenticated,
  initialError = null,
  onClearInitialError,
}: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(
    null
  );
  const [error, setError] = useState<string | null>(initialError);

  // Pending verification screen state
  const [pendingEmail, setPendingEmail] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState(30);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  function clearErrors() {
    setError(null);
    setResendMessage(null);
    onClearInitialError?.();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await api.register(trimmedEmail, password);
        setPendingEmail(res.email || trimmedEmail);
        setExpiresInMinutes(res.expiresInMinutes || 30);
        setCooldownSeconds(60);
        setVerifyNote(null);
        setMode('verify');
        return;
      }

      const res = await api.login(trimmedEmail, password);
      onAuthenticated(res.user);
    } catch (err) {
      const apiErr = err as ApiRequestError;
      if (apiErr?.code === 'EMAIL_NOT_VERIFIED') {
        const targetEmail =
          typeof apiErr.data?.email === 'string'
            ? apiErr.data.email
            : trimmedEmail;
        setPendingEmail(targetEmail);
        setExpiresInMinutes(30);
        setCooldownSeconds(apiErr.retryAfter ?? 60);
        setVerifyNote(apiErr.message);
        setError(null);
        setMode('verify');
        return;
      }
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail || cooldownSeconds > 0 || loading) return;
    clearErrors();
    setLoading(true);
    try {
      const res = await api.resendVerification(pendingEmail);
      setResendMessage('A new verification link has been sent to your email.');
      setCooldownSeconds(res.retryAfter || 60);
    } catch (err) {
      const apiErr = err as ApiRequestError;
      if (apiErr?.retryAfter) {
        setCooldownSeconds(apiErr.retryAfter);
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Could not resend verification email.'
      );
    } finally {
      setLoading(false);
    }
  }

  function handleOAuth(provider: 'google' | 'github') {
    clearErrors();
    setOauthLoading(provider);
    window.location.href = api.oauthUrl(provider);
  }

  const headingLabel =
    mode === 'verify'
      ? 'Verify transmission'
      : mode === 'register'
        ? 'Initialize identity'
        : 'Access terminal';

  return (
    <div className="relative min-h-screen bg-[#070709] text-white flex flex-col">
      <AmbientBackdrop status="unauthorized" />

      {/* Minimal HUD Header */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5 border-b border-white/[0.08] bg-[#070709]/80 backdrop-blur-md">
        <KansoLogo />
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span>simplicity in execution</span>
        </div>
      </header>

      {/* Center Auth Terminal */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md flex flex-col items-center text-center"
        >
          {/* Glowing Minimal Emblem */}
          <div
            aria-hidden="true"
            className="mb-3 flex items-center justify-center drop-shadow-[0_0_14px_rgba(255,255,255,0.75)]"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="4.5" height="7" rx="1" fill="#FFFFFF" />
              <rect x="10.5" y="4" width="3.5" height="12" rx="1" fill="#FFFFFF" />
              <rect x="16" y="7" width="4" height="5" rx="1" fill="#FFFFFF" />
              <circle cx="6.2" cy="15.5" r="1.7" fill="#FFFFFF" />
              <circle cx="17.8" cy="16.5" r="1.4" fill="#FFFFFF" />
            </svg>
          </div>

          <p className="text-[10px] font-mono uppercase tracking-[0.26em] text-zinc-500 mb-2">
            KANSO // AUTH_GATEWAY
          </p>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-wide text-zinc-100 flex items-center justify-center gap-1.5">
            <span>{headingLabel}</span>
            <span
              aria-hidden="true"
              className="inline-block w-[3px] h-6 bg-white rounded-[1px] shadow-[0_0_10px_rgba(255,255,255,0.9)] animate-kanso-caret"
            />
          </h1>

          {/* Six subtle dots divider */}
          <div
            aria-hidden="true"
            className="mt-2.5 mb-6 flex items-center justify-center gap-1.5"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className="h-1 w-1 rounded-full bg-zinc-500/80"
              />
            ))}
          </div>

          {mode === 'verify' ? (
            <div className="w-full rounded-3xl border border-white/15 bg-[#0D0E12]/90 backdrop-blur-xl p-6 sm:p-7 text-left shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/[0.06] mb-4">
                <MailCheck className="w-5 h-5 text-white" />
              </div>

              <h2 className="text-lg font-semibold text-white mb-2">
                Check your email
              </h2>

              <p className="text-sm text-zinc-300 leading-relaxed mb-2">
                {verifyNote ? (
                  verifyNote
                ) : (
                  <>
                    We sent a verification link to{' '}
                    <strong className="text-white">{pendingEmail}</strong>.
                    Click the link in that email to activate your account and
                    sign in.
                  </>
                )}
              </p>

              <p className="text-xs text-zinc-500 mb-5">
                Link expires in {expiresInMinutes} minutes. Check spam if you
                do not see it.
              </p>

              {error && (
                <p className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
                  {error}
                </p>
              )}

              {resendMessage && (
                <p className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300">
                  {resendMessage}
                </p>
              )}

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={loading || cooldownSeconds > 0}
                  onClick={handleResend}
                  className="w-full flex items-center justify-center gap-2 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 disabled:opacity-45 py-2.5 px-6 text-xs font-semibold transition"
                >
                  <span>
                    {cooldownSeconds > 0
                      ? `Resend link (${cooldownSeconds}s)`
                      : 'Resend verification email'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    clearErrors();
                    setEmail(pendingEmail);
                    setPassword('');
                    setMode('login');
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] hover:border-white/30 text-zinc-300 py-2.5 px-5 text-xs font-medium transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to sign in</span>
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="w-full rounded-3xl border border-white/15 bg-[#0D0E12]/90 backdrop-blur-xl p-6 sm:p-7 text-left shadow-[0_24px_80px_rgba(0,0,0,0.7)]"
            >
              {/* Mode Switcher */}
              <div className="grid grid-cols-2 gap-1 rounded-full bg-[#070709] p-1 border border-white/10 mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    clearErrors();
                  }}
                  className={`rounded-full py-2 text-xs font-semibold transition ${
                    mode === 'login'
                      ? 'bg-white text-[#070709]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    clearErrors();
                  }}
                  className={`rounded-full py-2 text-xs font-semibold transition ${
                    mode === 'register'
                      ? 'bg-white text-[#070709]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Create account
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-white/40 focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={72}
                    autoComplete={
                      mode === 'register' ? 'new-password' : 'current-password'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-white/40 focus:outline-none transition"
                  />
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    *Password must be at least 8 characters in length
                  </p>
                </div>
              </div>

              {error && (
                <p className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
                  {error}
                </p>
              )}

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={loading || oauthLoading !== null}
                  className="w-full flex items-center justify-center gap-2 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 disabled:opacity-45 py-3 px-6 text-sm font-semibold transition"
                >
                  <span>
                    {loading
                      ? mode === 'register'
                        ? 'Sending verification...'
                        : 'Signing in...'
                      : mode === 'login'
                        ? 'Enter kanso'
                        : 'Create account'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {/* Divider */}
                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-white/10" />
                  <span className="mx-3 shrink-0 text-xs text-zinc-500">
                    or
                  </span>
                  <div className="flex-grow border-t border-white/10" />
                </div>

                {/* OAuth Providers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={loading || oauthLoading !== null}
                    onClick={() => handleOAuth('google')}
                    className="flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] hover:border-white/30 disabled:opacity-45 py-2.5 px-4 text-xs font-medium text-zinc-200 transition"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      aria-hidden="true"
                    >
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    <span>
                      {oauthLoading === 'google' ? 'Linking...' : 'Google'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={loading || oauthLoading !== null}
                    onClick={() => handleOAuth('github')}
                    className="flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] hover:border-white/30 disabled:opacity-45 py-2.5 px-4 text-xs font-medium text-zinc-200 transition"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      aria-hidden="true"
                      fill="currentColor"
                    >
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                    <span>
                      {oauthLoading === 'github' ? 'Linking...' : 'GitHub'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </motion.div>
      </main>
    </div>
  );
}
