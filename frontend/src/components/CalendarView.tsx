'use client';

import React from 'react';
import { ArrowLeft, Calendar as CalendarIcon, Clock } from 'lucide-react';

interface CalendarViewProps {
  onBackHome: () => void;
}

const PREVIEW_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({ onBackHome }: CalendarViewProps) {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-[calc(100vh-120px)] px-6 py-12 text-center">
      {/* Subtle decorative dark calendar grid in background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto max-w-3xl opacity-[0.08] px-6"
      >
        <div className="grid grid-cols-7 gap-2.5">
          {PREVIEW_DAYS.map((day) => (
            <div
              key={day}
              className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 pb-2"
            >
              {day}
            </div>
          ))}
          {Array.from({ length: 21 }).map((_, idx) => (
            <div
              key={idx}
              className={`h-16 rounded-2xl border ${
                idx === 9
                  ? 'border-white/40 bg-white/15'
                  : 'border-white/15 bg-white/[0.03]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Centered Content */}
      <div className="relative z-10 max-w-xl mx-auto">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#141418] px-4 py-1.5 text-xs font-medium text-zinc-300 mb-6">
          <CalendarIcon className="w-3.5 h-3.5 text-zinc-400" />
          <span>Calendar</span>
        </div>

        <h1 className="text-5xl sm:text-7xl font-bold tracking-[-0.04em] leading-[1.03] text-white mb-5">
          Coming soon!
        </h1>

        <p className="text-sm sm:text-base text-zinc-400 max-w-md mx-auto leading-relaxed mb-9">
          Upcoming deadline scheduling, daily time-blocking, and focus session
          history timelines will live here—designed to keep your days calm and
          intentional.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-2 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-6 py-3 text-sm font-semibold shadow-[0_0_30px_rgba(255,255,255,0.14)] transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </button>

          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#16161A] px-5 py-3 text-xs font-medium text-zinc-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Phase 2 Roadmap</span>
          </div>
        </div>
      </div>
    </div>
  );
}
