'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import type { PageIndex, TaskBoard } from '@/types/kanso';

interface AmbientBackdropProps {
  boards?: TaskBoard[];
  status?: 'online' | 'unauthorized';
  pageIndex?: PageIndex;
  isWorkingMode?: boolean;
  isRunning?: boolean;
  activeColor?: string | null;
}

/**
 * Persistent sci-fi minimalist HUD frame matching the Name Onboarding aesthetic:
 * - Visor scanlines, diagonal hatch bar, and deep orbital crosshairs
 * - 60fps cursor-parallax horizon depth
 * - Context-reactive radial glow
 * - Traveling SVG light shimmer along top and bottom curved horizon arcs
 * - Live SIGNAL telemetry + ping readout, interactive sliding scale ruler, and kanso emblem
 */
export function AmbientBackdrop({
  boards: _boards,
  status = 'online',
  pageIndex = 1,
  isWorkingMode = false,
  isRunning = false,
  activeColor = null,
}: AmbientBackdropProps) {
  const isUnauthorized = status === 'unauthorized';
  const uid = useId().replace(/:/g, '');
  const topGradId = `kanso-top-shimmer-${uid}`;
  const bottomGradId = `kanso-bottom-shimmer-${uid}`;

  const [pingMs, setPingMs] = useState(21);

  const glowRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const topArcRef = useRef<HTMLDivElement | null>(null);
  const bottomArcRef = useRef<HTMLDivElement | null>(null);

  // Subtle live latency jitter for HUD telemetry readout
  useEffect(() => {
    if (isUnauthorized) return;
    const interval = window.setInterval(() => {
      setPingMs(18 + Math.floor(Math.random() * 11));
    }, 3500);
    return () => window.clearInterval(interval);
  }, [isUnauthorized]);

  // Smooth 60fps cursor-parallax via refs (no React re-renders)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let rafId = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      targetX = (e.clientX / w - 0.5) * 2;
      targetY = (e.clientY / h - 0.5) * 2;
    };

    const tick = () => {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;

      if (glowRef.current) {
        glowRef.current.style.transform = `translate3d(${(currentX * 22).toFixed(2)}px, ${(currentY * 16).toFixed(2)}px, 0)`;
      }
      if (gridRef.current) {
        gridRef.current.style.transform = `translate3d(${(currentX * -14).toFixed(2)}px, ${(currentY * -10).toFixed(2)}px, 0)`;
      }
      if (topArcRef.current) {
        topArcRef.current.style.transform = `translate3d(${(currentX * -7).toFixed(2)}px, ${(currentY * -4).toFixed(2)}px, 0)`;
      }
      if (bottomArcRef.current) {
        bottomArcRef.current.style.transform = `translate3d(${(currentX * -7).toFixed(2)}px, ${(currentY * -4).toFixed(2)}px, 0)`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const reactiveTint = isUnauthorized
    ? 'rgba(250, 204, 21, 0.065)'
    : activeColor
      ? isRunning
        ? `${activeColor}20`
        : isWorkingMode
          ? `${activeColor}17`
          : `${activeColor}10`
      : isRunning
        ? 'rgba(52, 211, 153, 0.08)'
        : 'rgba(255, 255, 255, 0.04)';

  const rulerNeedleLeft =
    pageIndex === 0 ? '16.67%' : pageIndex === 2 ? '83.33%' : '50%';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden select-none z-0"
    >
      {/* Base Obsidian Atmospheric Dark Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.06) 0%, rgba(7,7,9,0.84) 58%, #040406 100%)',
        }}
      />

      {/* Context-Reactive Parallax Radial Glow */}
      <div
        ref={glowRef}
        className="absolute -inset-16 transition-[background] duration-700 will-change-transform"
        style={{
          background: `radial-gradient(ellipse 54% 46% at 50% 46%, ${reactiveTint} 0%, transparent 71%)`,
        }}
      />

      {/* Deep Visor Calibration Layer (cursor parallax) */}
      <div
        ref={gridRef}
        className="absolute inset-0 will-change-transform opacity-65"
      >
        {/* Dot-Matrix Calibration Grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.075) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
            maskImage:
              'radial-gradient(ellipse 68% 60% at 50% 48%, black 25%, transparent 82%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 68% 60% at 50% 48%, black 25%, transparent 82%)',
          }}
        />

        {/* Subtle Center Axis Hairlines */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gradient-to-b from-transparent via-white/[0.04] to-transparent" />

        {/* Inner & Outer Concentric Orbital Rings */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[460px] sm:w-[620px] sm:h-[620px] rounded-full border border-white/[0.055]" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[640px] sm:w-[880px] sm:h-[880px] rounded-full border border-dashed border-white/[0.04]" />

        <span className="hidden md:block absolute top-[22%] left-[12%] font-mono text-xs text-white/25">
          +
        </span>
        <span className="hidden md:block absolute top-[22%] right-[12%] font-mono text-xs text-white/25">
          +
        </span>
        <span className="hidden md:block absolute bottom-[22%] left-[12%] font-mono text-xs text-white/25">
          +
        </span>
        <span className="hidden md:block absolute bottom-[22%] right-[12%] font-mono text-xs text-white/25">
          +
        </span>
      </div>

      {/* Balanced Visor Scanlines & Edge Vignette */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(255,255,255,0.019) 0px, rgba(255,255,255,0.019) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, transparent 56%, rgba(0,0,0,0.42) 100%)',
        }}
      />

      {/* Top Curved HUD Horizon Arc + Diagonal Hatching Bar */}
      <div
        ref={topArcRef}
        className="absolute inset-x-0 top-14 sm:top-16 max-w-6xl mx-auto px-6 opacity-70 will-change-transform"
      >
        <div className="flex items-end justify-between text-[10px] font-mono text-zinc-400 mb-0.5 px-1">
          <div className="flex flex-col gap-1">
            {/* Slanted Diagonal Hatch Bar matching reference visor */}
            <div className="hidden sm:flex flex-col gap-0.5">
              <div
                className="w-24 sm:w-28 h-2.5 skew-x-[-18deg] opacity-80"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(-55deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1.5px, transparent 1.5px, transparent 4.5px)',
                }}
              />
              <span className="block h-[2px] w-8 bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.7)]" />
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-block h-[2px] w-12 bg-gradient-to-r from-white/45 to-transparent" />
              <span className="tracking-[0.25em] text-zinc-400/80">
                ••• ••• ••
              </span>
            </div>
          </div>

          <span
            className={`inline-block h-1 rounded-full bg-white transition-all duration-500 ${
              isRunning
                ? 'w-6 shadow-[0_0_14px_rgba(255,255,255,1)]'
                : 'w-4 shadow-[0_0_10px_rgba(255,255,255,0.85)]'
            }`}
          />
        </div>

        <svg
          viewBox="0 0 1000 30"
          className="w-full h-5 overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={topGradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255,255,255,0)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.85)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <path
            d="M 0 30 Q 500 -6 1000 30"
            fill="none"
            stroke="rgba(255,255,255,0.34)"
            strokeWidth="1.1"
          />
          <path
            d="M 0 30 Q 500 -6 1000 30"
            fill="none"
            stroke={`url(#${topGradId})`}
            strokeWidth="2"
            pathLength="1000"
            className="animate-kanso-arc-sweep"
          />
        </svg>
      </div>

      {/* Bottom Curved HUD Horizon Arc + Interactive 13-Tick Ruler & Telemetry */}
      <div
        ref={bottomArcRef}
        className="absolute inset-x-0 bottom-3 sm:bottom-5 max-w-6xl mx-auto px-6 flex flex-col items-center opacity-70 will-change-transform"
      >
        <svg
          viewBox="0 0 1000 30"
          className="w-full h-5 overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient
              id={bottomGradId}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="rgba(255,255,255,0)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.85)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <path
            d="M 0 4 Q 500 40 1000 4"
            fill="none"
            stroke="rgba(255,255,255,0.34)"
            strokeWidth="1.1"
          />
          <path
            d="M 0 4 Q 500 40 1000 4"
            fill="none"
            stroke={`url(#${bottomGradId})`}
            strokeWidth="2"
            pathLength="1000"
            className="animate-kanso-arc-sweep-delayed"
          />
        </svg>

        <div className="relative w-full flex items-end justify-center sm:grid sm:grid-cols-3 sm:items-end gap-4 px-1 -mt-1">
          {/* Bottom-Left: Signal Status + 3-Bar Meter + Live Latency Ping */}
          <div className="hidden sm:flex items-center gap-2 text-[9px] font-mono tracking-[0.22em] text-zinc-400 justify-self-start">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isUnauthorized
                  ? 'bg-yellow-400/90 shadow-[0_0_8px_rgba(250,204,21,0.75)]'
                  : isRunning
                    ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                    : 'bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
              }`}
            />
            <span>
              {isUnauthorized ? 'SIGNAL // UNAUTHORIZED' : 'SIGNAL // ONLINE'}
            </span>
            <span className="inline-flex items-end gap-[1.5px] h-2 opacity-85">
              <span
                className={`w-[1.5px] h-1 ${
                  isUnauthorized ? 'bg-yellow-400/70' : 'bg-emerald-400/75'
                }`}
              />
              <span
                className={`w-[1.5px] h-1.5 ${
                  isUnauthorized ? 'bg-yellow-400/50' : 'bg-emerald-400/80'
                }`}
              />
              <span
                className={`w-[1.5px] h-2 ${
                  isUnauthorized ? 'bg-zinc-600' : 'bg-emerald-400'
                }`}
              />
            </span>
            <span className="tracking-[0.12em] text-zinc-500">
              {isUnauthorized ? '--ms' : `${pingMs}ms`}
            </span>
          </div>

          {/* Bottom-Center: 13-Tick Scale Ruler with Sliding Spatial Needle */}
          <div className="flex flex-col items-center sm:justify-self-center">
            <div className="w-40 sm:w-56 h-[1px] bg-white/45 relative flex items-center justify-between">
              {Array.from({ length: 13 }).map((_, idx) => {
                const isCenterBand = isRunning && idx >= 4 && idx <= 8;
                return (
                  <span
                    key={idx}
                    className={`w-[1px] transition-opacity duration-300 ${
                      isCenterBand
                        ? 'bg-white animate-pulse shadow-[0_0_6px_rgba(255,255,255,0.85)]'
                        : 'bg-white/75'
                    } ${
                      idx === 6
                        ? 'h-2.5 -mt-1'
                        : idx % 3 === 0
                          ? 'h-1.5 -mt-0.5'
                          : 'h-1'
                    }`}
                  />
                );
              })}

              {/* Sliding spatial needle aligned to active tab (0: Tasks, 1: Home, 2: Calendar) */}
              <span
                style={{ left: rulerNeedleLeft }}
                className="absolute -bottom-[3px] -translate-x-1/2 h-1.5 w-1.5 rotate-45 bg-white shadow-[0_0_8px_rgba(255,255,255,0.95)] transition-all duration-500 ease-out"
              />
            </div>

            <div className="w-40 sm:w-56 flex items-center justify-between text-[7px] font-mono text-zinc-400/85 mt-1 px-0.5">
              <span>‹</span>
              <span>0</span>
              <span>›</span>
            </div>

            <span className="mt-0.5 text-[8px] font-mono tracking-[0.3em] text-zinc-400/90">
              KANSO // WORKSPACE
            </span>
          </div>

          {/* Bottom-Right: Geometric Emblem Mark */}
          <div className="absolute right-1 bottom-0 sm:static sm:justify-self-end flex items-center opacity-75">
            <svg
              width="20"
              height="16"
              viewBox="0 0 24 20"
              fill="none"
              className="drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]"
            >
              <rect x="4" y="4" width="4" height="6.5" rx="1" fill="#FFFFFF" />
              <rect x="10" y="3" width="3.2" height="11" rx="1" fill="#FFFFFF" />
              <rect x="15.2" y="6" width="3.8" height="5" rx="1" fill="#FFFFFF" />
              <circle cx="6" cy="14.5" r="1.4" fill="#FFFFFF" />
              <circle cx="17" cy="15.2" r="1.2" fill="#FFFFFF" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
