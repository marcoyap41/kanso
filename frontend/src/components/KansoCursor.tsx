'use client';

import React, { useEffect, useRef, useState } from 'react';

type CursorMode = 'idle' | 'pointer' | 'text';

const INTERACTIVE_SELECTOR =
  'button:not(:disabled), a[href], [role="button"], select, input[type="checkbox"], input[type="radio"], .cursor-pointer';

const TEXT_SELECTOR =
  'input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="search"], textarea, [contenteditable="true"], .cursor-text';

function detectCursorMode(target: EventTarget | null): CursorMode {
  if (!(target instanceof Element)) return 'idle';
  if (target.closest(TEXT_SELECTOR)) return 'text';
  if (target.closest(INTERACTIVE_SELECTOR)) return 'pointer';
  return 'idle';
}

const CUSTOM_CURSOR_STORAGE_KEY = 'kanso_custom_cursor';
const CUSTOM_CURSOR_EVENT = 'kanso:cursor-change';

export function getCustomCursorEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CUSTOM_CURSOR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setCustomCursorEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CUSTOM_CURSOR_STORAGE_KEY,
      enabled ? 'true' : 'false'
    );
  } catch {
    // Ignore storage quota / privacy mode errors
  }
  window.dispatchEvent(
    new CustomEvent<boolean>(CUSTOM_CURSOR_EVENT, { detail: enabled })
  );
}

export function KansoCursor() {
  const [finePointer, setFinePointer] = useState(false);
  const [userEnabled, setUserEnabled] = useState(false);
  const [mode, setMode] = useState<CursorMode>('idle');
  const [pressed, setPressed] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const coordRef = useRef<HTMLSpanElement | null>(null);
  const pulseRef = useRef<HTMLDivElement | null>(null);

  const modeRef = useRef<CursorMode>('idle');
  const posRef = useRef({ x: -100, y: -100 });
  const visibleRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');

    const syncPointer = () => {
      setFinePointer(mq.matches);
    };
    const syncPreference = () => {
      setUserEnabled(getCustomCursorEnabled());
    };
    const handleCustomEvent = (e: Event) => {
      const customEvt = e as CustomEvent<boolean>;
      if (typeof customEvt.detail === 'boolean') {
        setUserEnabled(customEvt.detail);
      } else {
        syncPreference();
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CUSTOM_CURSOR_STORAGE_KEY) {
        syncPreference();
      }
    };

    syncPointer();
    syncPreference();

    mq.addEventListener?.('change', syncPointer);
    window.addEventListener(CUSTOM_CURSOR_EVENT, handleCustomEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      mq.removeEventListener?.('change', syncPointer);
      window.removeEventListener(CUSTOM_CURSOR_EVENT, handleCustomEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const enabled = finePointer && userEnabled;

  useEffect(() => {
    if (!enabled) {
      document.documentElement.classList.remove('kanso-custom-cursor');
      visibleRef.current = false;
      setPressed(false);
      return;
    }

    document.documentElement.classList.add('kanso-custom-cursor');

    let ringX = posRef.current.x;
    let ringY = posRef.current.y;
    let rafId = 0;

    const showCursor = () => {
      if (!visibleRef.current) {
        visibleRef.current = true;
        if (containerRef.current) {
          containerRef.current.style.opacity = '1';
        }
      }
    };

    const hideCursor = () => {
      if (visibleRef.current) {
        visibleRef.current = false;
        if (containerRef.current) {
          containerRef.current.style.opacity = '0';
        }
      }
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const updateCoordLabel = (
      currentMode: CursorMode,
      x: number,
      y: number
    ) => {
      if (!coordRef.current) return;
      if (currentMode === 'pointer') {
        coordRef.current.textContent = 'LOCK // ACT';
      } else if (currentMode === 'text') {
        coordRef.current.textContent = 'INPUT // TXT';
      } else {
        const cx = String(Math.max(0, Math.round(x))).padStart(4, '0');
        const cy = String(Math.max(0, Math.round(y))).padStart(4, '0');
        coordRef.current.textContent = `X:${cx} Y:${cy}`;
      }
    };

    const applyRingPosition = (rx: number, ry: number, x: number, y: number) => {
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;
      }
      if (coordRef.current) {
        coordRef.current.style.transform = `translate3d(${(rx + 18).toFixed(2)}px, ${(ry + 14).toFixed(2)}px, 0)`;
        updateCoordLabel(modeRef.current, x, y);
      }
    };

    const tick = () => {
      const { x, y } = posRef.current;
      const dx = x - ringX;
      const dy = y - ringY;

      if (Math.hypot(dx, dy) < 0.1) {
        ringX = x;
        ringY = y;
        applyRingPosition(ringX, ringY, x, y);
        rafId = 0;
        return;
      }

      ringX += dx * 0.18;
      ringY += dy * 0.18;
      applyRingPosition(ringX, ringY, x, y);
      rafId = window.requestAnimationFrame(tick);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const firstShow = !visibleRef.current;

      posRef.current.x = clientX;
      posRef.current.y = clientY;
      showCursor();

      if (coreRef.current) {
        coreRef.current.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
      }

      const nextMode = detectCursorMode(e.target);
      if (nextMode !== modeRef.current) {
        modeRef.current = nextMode;
        setMode(nextMode);
      }

      if (firstShow) {
        ringX = clientX;
        ringY = clientY;
        applyRingPosition(ringX, ringY, clientX, clientY);
      } else if (rafId === 0) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      setPressed(true);
      const { clientX, clientY } = e;
      if (pulseRef.current) {
        pulseRef.current.animate(
          [
            {
              opacity: 0.9,
              transform: `translate3d(${clientX}px, ${clientY}px, 0) scale(0.55) rotate(0deg)`,
            },
            {
              opacity: 0,
              transform: `translate3d(${clientX}px, ${clientY}px, 0) scale(1.9) rotate(45deg)`,
            },
          ],
          {
            duration: 360,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          }
        );
      }
    };

    const handleMouseUp = () => {
      setPressed(false);
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        hideCursor();
      }
    };

    const handleBlur = () => {
      setPressed(false);
      hideCursor();
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mousedown', handleMouseDown, { passive: true });
    window.addEventListener('mouseup', handleMouseUp, { passive: true });
    window.addEventListener('mouseout', handleMouseOut, { passive: true });
    window.addEventListener('blur', handleBlur);

    return () => {
      document.documentElement.classList.remove('kanso-custom-cursor');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseout', handleMouseOut);
      window.removeEventListener('blur', handleBlur);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{ opacity: 0 }}
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden select-none transition-opacity duration-150"
    >
      {/* Click Pulse Diamond/Bracket Ring */}
      <div
        ref={pulseRef}
        style={{ opacity: 0 }}
        className="fixed left-0 top-0 w-7 h-7 -ml-3.5 -mt-3.5 border border-white/80 shadow-[0_0_12px_rgba(255,255,255,0.65)] will-change-transform"
      />

      {/* Delayed Outer HUD Bracket / Crosshair Reticle */}
      <div
        ref={ringRef}
        className="fixed left-0 top-0 w-12 h-12 -ml-6 -mt-6 flex items-center justify-center will-change-transform"
      >
        <div
          className={`relative flex items-center justify-center transition-all duration-200 ease-out ${
            mode === 'pointer'
              ? pressed
                ? 'h-7 w-7 rotate-45 scale-75 opacity-100'
                : 'h-[38px] w-[38px] rotate-45 opacity-95'
              : mode === 'text'
                ? 'h-6 w-3 rotate-0 opacity-80'
                : pressed
                  ? 'h-6 w-6 scale-75 opacity-90'
                  : 'h-7 w-7 rotate-0 opacity-70'
          }`}
        >
          {mode === 'text' ? (
            <>
              <span className="absolute top-0 inset-x-0 h-[1.5px] bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
              <span className="absolute bottom-0 inset-x-0 h-[1.5px] bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
            </>
          ) : (
            <>
              {/* 4 Crisp Corner Brackets */}
              <span className="absolute left-0 top-0 h-2 w-2 border-l-[1.5px] border-t-[1.5px] border-white shadow-[0_0_8px_rgba(255,255,255,0.55)]" />
              <span className="absolute right-0 top-0 h-2 w-2 border-r-[1.5px] border-t-[1.5px] border-white shadow-[0_0_8px_rgba(255,255,255,0.55)]" />
              <span className="absolute left-0 bottom-0 h-2 w-2 border-l-[1.5px] border-b-[1.5px] border-white shadow-[0_0_8px_rgba(255,255,255,0.55)]" />
              <span className="absolute right-0 bottom-0 h-2 w-2 border-r-[1.5px] border-b-[1.5px] border-white shadow-[0_0_8px_rgba(255,255,255,0.55)]" />

              {/* Subtle axis crosshair ticks */}
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-1 w-[1px] bg-white/45" />
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-[1px] bg-white/45" />
              <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-[1px] bg-white/45" />
              <span className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-[1px] bg-white/45" />
            </>
          )}
        </div>
      </div>

      {/* Instant 1:1 Center White Dot / Text Caret */}
      <div
        ref={coreRef}
        className="fixed left-0 top-0 w-12 h-12 -ml-6 -mt-6 flex items-center justify-center will-change-transform"
      >
        {mode === 'text' ? (
          <span className="block w-[2.5px] h-5 rounded-[1px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)] transition-all duration-150" />
        ) : (
          <span
            className={`block rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)] transition-transform duration-150 ${
              mode === 'pointer'
                ? pressed
                  ? 'h-1.5 w-1.5 scale-125'
                  : 'h-1.5 w-1.5 scale-100'
                : pressed
                  ? 'h-[5px] w-[5px] scale-150'
                  : 'h-[5px] w-[5px] scale-100'
            }`}
          />
        )}
      </div>

      {/* Micro HUD Telemetry Coordinate Readout */}
      <span
        ref={coordRef}
        className="fixed left-0 top-0 whitespace-nowrap text-[8px] font-mono tracking-[0.14em] text-zinc-400/55 will-change-transform"
      >
        X:0000 Y:0000
      </span>
    </div>
  );
}
