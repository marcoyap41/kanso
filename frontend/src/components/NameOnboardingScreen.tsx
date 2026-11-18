'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import type { User } from '@/types/kanso';

interface NameOnboardingScreenProps {
  initialName?: string;
  onCompleted: (user: User) => void;
  onCancel?: () => void;
}

const ASIAN_CHAR_RE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g;

function getLimitViolation(raw: string): boolean {
  const asianCount = (raw.match(ASIAN_CHAR_RE) || []).length;
  return raw.length > 16 || asianCount > 7;
}

export function NameOnboardingScreen({
  initialName = '',
  onCompleted,
  onCancel,
}: NameOnboardingScreenProps) {
  const [name, setName] = useState(initialName);
  const [cursorPos, setCursorPos] = useState<number>(initialName.length);
  const [isFocused, setIsFocused] = useState(true);
  const [limitFlash, setLimitFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const len = initialName.length;
    inputRef.current?.setSelectionRange(len, len);
    setCursorPos(len);
  }, [initialName]);

  useEffect(() => {
    if (!onCancel) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  useEffect(() => {
    if (!limitFlash) return;
    const t = window.setTimeout(() => setLimitFlash(false), 1800);
    return () => window.clearTimeout(t);
  }, [limitFlash]);

  const trimmed = name.trim();
  const isOverLimit = getLimitViolation(name);

  function syncCaret(el: HTMLInputElement) {
    const pos = el.selectionStart ?? el.value.length;
    setCursorPos(pos);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const nextVal = e.target.value;
    setError(null);
    if (getLimitViolation(nextVal)) {
      setLimitFlash(true);
    }
    setName(nextVal);
    syncCaret(e.target);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;

    if (getLimitViolation(trimmed)) {
      setLimitFlash(true);
      setError('Name cannot exceed 7 Asian or 16 alphanumeric characters in length.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const res = await api.updateProfile(trimmed);
      onCompleted(res.user);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save display name'
      );
    } finally {
      setBusy(false);
    }
  }

  const safeCursor = Math.min(cursorPos, name.length);
  const beforeCaret = name.slice(0, safeCursor);
  const afterCaret = name.slice(safeCursor);

  return (
    <div className="fixed inset-0 z-50 bg-[#070709] text-white flex flex-col items-center justify-between overflow-hidden select-none">
      <style>{`
        @keyframes kansoCaretBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>

      {/* Subtle atmospheric dark vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.045)_0%,rgba(10,10,12,0.85)_58%,#040406_100%)]"
      />

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel change name"
          title="Close"
          className="absolute top-6 right-6 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] hover:bg-white hover:text-[#0A0A0C] text-zinc-400 transition"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Top Curved HUD Arc & Micro Status Details */}
      <div className="relative z-10 w-full max-w-5xl px-6 pt-10 sm:pt-14 pointer-events-none">
        <div className="flex items-end justify-between text-[10px] font-mono text-zinc-500 mb-1 px-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-14 bg-gradient-to-r from-white/35 to-transparent" />
            <span className="tracking-[0.25em] text-zinc-400/80">
              ••• ••• ••
            </span>
          </div>
          <span className="inline-block h-1.5 w-5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
        </div>

        <svg
          viewBox="0 0 1000 34"
          className="w-full h-7 overflow-visible opacity-65"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M 0 30 Q 500 -6 1000 30"
            fill="none"
            stroke="rgba(255,255,255,0.38)"
            strokeWidth="1"
          />
        </svg>
      </div>

      {/* Center Interactive Name Prompt */}
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-lg px-6 flex flex-col items-center text-center"
      >
        {/* Glowing Minimal Emblem */}
        <div
          aria-hidden="true"
          className="mb-3.5 flex items-center justify-center"
        >
          <div className="flex items-center justify-center rounded-xl p-1.5 drop-shadow-[0_0_14px_rgba(255,255,255,0.75)]">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="4.5" height="7" rx="1.2" fill="#FFFFFF" />
              <rect x="10.5" y="4" width="3.5" height="12" rx="1.2" fill="#FFFFFF" />
              <rect x="16" y="7" width="4" height="5" rx="1.2" fill="#FFFFFF" />
              <circle cx="6.2" cy="15.5" r="1.8" fill="#FFFFFF" />
              <circle cx="17.8" cy="16.5" r="1.5" fill="#FFFFFF" />
            </svg>
          </div>
        </div>

        {/* "And you are—" heading */}
        <h1 className="text-lg sm:text-xl font-medium tracking-wide text-zinc-100">
          And you are—
        </h1>

        {/* Six subtle dots */}
        <div
          aria-hidden="true"
          className="mt-2 mb-5 flex items-center justify-center gap-1.5"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full bg-zinc-500/80"
            />
          ))}
        </div>

        {/* Centered Dark Translucent Input Bar with Active Bold Blinking Caret */}
        <div
          onClick={() => inputRef.current?.focus()}
          className={`relative w-full max-w-[440px] h-12 rounded-[2px] border transition flex items-center justify-center px-6 cursor-text ${
            isOverLimit || limitFlash
              ? 'bg-rose-500/[0.08] border-rose-400/45'
              : isFocused
                ? 'bg-white/[0.085] border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]'
                : 'bg-white/[0.06] border-white/10'
          }`}
        >
          {/* Real interactive input rendered transparently over visual layer */}
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onSelect={(e) => syncCaret(e.currentTarget)}
            onKeyUp={(e) => syncCaret(e.currentTarget)}
            onMouseUp={(e) => syncCaret(e.currentTarget)}
            autoComplete="name"
            aria-label="Enter your name"
            className="absolute inset-0 z-10 w-full h-full bg-transparent text-center text-sm sm:text-base font-medium tracking-wide text-transparent caret-transparent focus:outline-none selection:bg-white/20"
          />

          {/* Visual Mirror with Bold Blinking Vertical Typing Line ( | ) */}
          <div className="pointer-events-none flex items-center justify-center max-w-full overflow-hidden">
            <span className="text-sm sm:text-base font-medium tracking-wide text-white whitespace-pre">
              {beforeCaret}
            </span>
            {isFocused && (
              <span
                aria-hidden="true"
                style={{ animation: 'kansoCaretBlink 1s steps(2, start) infinite' }}
                className="inline-block w-[3px] h-6 bg-white rounded-[1px] shadow-[0_0_10px_rgba(255,255,255,0.95)] mx-[1px] shrink-0"
              />
            )}
            <span className="text-sm sm:text-base font-medium tracking-wide text-white whitespace-pre">
              {afterCaret}
            </span>
          </div>
        </div>

        {/* Helper / Character Limit Note */}
        <p
          className={`mt-3 text-[11px] tracking-wide transition-colors ${
            isOverLimit || limitFlash ? 'text-rose-300 font-medium' : 'text-zinc-500'
          }`}
        >
          *Name cannot exceed 7 Asian or 16 alphanumeric characters in length
        </p>

        {error && (
          <p className="mt-2.5 text-xs text-rose-300">{error}</p>
        )}

        {/* Confirm Button */}
        <button
          type="submit"
          disabled={busy || !trimmed || isOverLimit}
          className="mt-6 min-w-[164px] rounded-[2px] border border-white/25 bg-white/[0.03] hover:bg-white hover:text-[#0A0A0C] disabled:opacity-40 disabled:hover:bg-white/[0.03] disabled:hover:text-zinc-400 py-2 px-8 text-xs font-medium tracking-[0.14em] text-zinc-300 transition"
        >
          {busy ? 'Saving...' : 'Confirm'}
        </button>
      </motion.form>

      {/* Bottom Curved HUD Arc & Horizontal Scale Ruler */}
      <div className="relative z-10 w-full max-w-5xl px-6 pb-8 sm:pb-12 pointer-events-none flex flex-col items-center">
        <svg
          viewBox="0 0 1000 34"
          className="w-full h-7 overflow-visible opacity-65"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M 0 4 Q 500 40 1000 4"
            fill="none"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
          />
        </svg>

        {/* Centered Tick-Scale Ruler below bottom arc */}
        <div className="mt-1 flex flex-col items-center opacity-50">
          <div className="w-44 sm:w-56 h-[1px] bg-white/45 relative flex items-center justify-between">
            {Array.from({ length: 13 }).map((_, idx) => (
              <span
                key={idx}
                className={`w-[1px] bg-white/70 ${
                  idx === 6
                    ? 'h-2.5 -mt-1'
                    : idx % 3 === 0
                      ? 'h-1.5 -mt-0.5'
                      : 'h-1'
                }`}
              />
            ))}
          </div>
          <span className="mt-1.5 text-[8px] font-mono tracking-[0.3em] text-zinc-500">
            KANSO // IDENTITY
          </span>
        </div>
      </div>
    </div>
  );
}
