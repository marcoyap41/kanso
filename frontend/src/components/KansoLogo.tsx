'use client';

import React from 'react';

interface KansoLogoProps {
  onClick?: () => void;
}

/**
 * Glowing geometric HUD emblem inside a crisp rectangular frame + "kanso // OS" mark.
 */
export function KansoLogo({ onClick }: KansoLogoProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 text-left focus:outline-none"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/[0.06] shadow-[0_0_16px_rgba(255,255,255,0.12)] transition-all duration-200 group-hover:border-white/45 group-hover:bg-white/[0.12]">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]"
        >
          <rect x="4" y="4" width="4.5" height="7" rx="1" fill="#FFFFFF" />
          <rect x="10.5" y="4" width="3.5" height="12" rx="1" fill="#FFFFFF" />
          <rect x="16" y="7" width="4" height="5" rx="1" fill="#FFFFFF" />
          <circle cx="6.2" cy="15.5" r="1.7" fill="#FFFFFF" />
          <circle cx="17.8" cy="16.5" r="1.4" fill="#FFFFFF" />
        </svg>
      </span>
      <span className="text-base font-bold tracking-[-0.02em] text-white lowercase">
        kanso
      </span>
    </button>
  );
}
