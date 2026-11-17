'use client';

import React from 'react';

interface KansoLogoProps {
  onClick?: () => void;
}

/**
 * Circular white emblem + lowercase "kanso" wordmark echoing the reference header mark.
 */
export function KansoLogo({ onClick }: KansoLogoProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2.5 text-left focus:outline-none"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#0A0A0C] shadow-[0_0_24px_rgba(255,255,255,0.18)] transition-transform duration-200 group-hover:scale-105">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect x="3.5" y="3" width="3.5" height="10" rx="1.75" fill="#0A0A0C" />
          <rect x="9" y="3" width="3.5" height="10" rx="1.75" fill="#0A0A0C" />
        </svg>
      </span>
      <span className="text-base font-bold tracking-[-0.03em] text-white lowercase">
        kanso
      </span>
    </button>
  );
}
