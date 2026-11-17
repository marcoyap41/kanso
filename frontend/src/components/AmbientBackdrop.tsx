'use client';

import React from 'react';
import type { TaskBoard } from '@/types/kanso';

interface AmbientBackdropProps {
  boards?: TaskBoard[];
}

const DEFAULT_CARDS = [
  { label: '01 / Board', title: 'College', accent: '#38BDF8', subtle: 'Metopen' },
  { label: '02 / Task', title: 'Tugas 5.5', accent: '#FFFFFF', subtle: '3 micro-steps' },
  { label: '03 / Step', title: 'Read proposal', accent: '#A78BFA', subtle: '25:00 focus' },
  { label: '04 / Flow', title: 'Deep Work', accent: '#34D399', subtle: '50:10 cycle' },
  { label: '05 / Zen', title: 'One step', accent: '#FBBF24', subtle: 'Execute now' },
  { label: '06 / Rhythm', title: 'Kanso', accent: '#FB7185', subtle: 'Simplicity' },
];

/**
 * Peripheral floating micro-cards inspired by the Motion Grid dark reference aesthetic.
 * Stays pointer-events-none and subtly frames the centered focal workspace.
 */
export function AmbientBackdrop({ boards = [] }: AmbientBackdropProps) {
  const cards = DEFAULT_CARDS.map((card, idx) => {
    const board = boards[idx % Math.max(boards.length, 1)];
    if (!board) return card;
    const firstProject = board.projects[0];
    const firstTask = firstProject?.tasks[0];
    if (idx === 0) {
      return {
        label: 'Board',
        title: board.name,
        accent: board.color,
        subtle: `${board.projects.length} project${board.projects.length === 1 ? '' : 's'}`,
      };
    }
    if (idx === 1 && firstProject) {
      return {
        label: 'Project',
        title: firstProject.name,
        accent: board.color,
        subtle: `${firstProject.tasks.length} task${firstProject.tasks.length === 1 ? '' : 's'}`,
      };
    }
    if (idx === 2 && firstTask) {
      return {
        label: 'Micro-step',
        title: firstTask.subtasks[0]?.title || firstTask.title,
        accent: board.color,
        subtle: firstTask.title,
      };
    }
    return card;
  });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden select-none z-0"
    >
      {/* Subtle radial vignette glow in center */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 42%, rgba(255,255,255,0.035) 0%, rgba(10,10,12,0) 58%)',
        }}
      />

      {/* Top-left floating card */}
      <div className="hidden lg:block absolute top-24 left-[5%] w-40 rounded-xl border border-white/[0.06] bg-[#121216]/75 p-3.5 backdrop-blur-sm opacity-30 animate-float-slow">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: cards[0].accent }}
          />
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            {cards[0].label}
          </span>
        </div>
        <p className="text-sm font-semibold text-zinc-200 truncate">
          {cards[0].title}
        </p>
        <p className="text-[11px] text-zinc-500 mt-1 truncate">
          {cards[0].subtle}
        </p>
      </div>

      {/* Top-right floating card */}
      <div className="hidden lg:block absolute top-28 right-[6%] w-44 rounded-xl border border-white/[0.06] bg-[#121216]/70 p-3.5 backdrop-blur-sm opacity-25 animate-float-reverse">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            {cards[1].label}
          </span>
          <span
            className="h-1.5 w-6 rounded-full opacity-70"
            style={{ backgroundColor: cards[1].accent }}
          />
        </div>
        <p className="text-sm font-semibold text-zinc-200 truncate">
          {cards[1].title}
        </p>
        <p className="text-[11px] text-zinc-500 mt-1 truncate">
          {cards[1].subtle}
        </p>
      </div>

      {/* Mid-left blurred card */}
      <div className="hidden md:block absolute top-[48%] left-[3%] w-44 rounded-2xl border border-white/[0.05] bg-gradient-to-br from-white/[0.04] to-transparent p-4 opacity-20 blur-[0.4px] animate-float-reverse">
        <div className="flex items-center gap-2 mb-2.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: cards[2].accent }}
          />
          <span className="text-[10px] uppercase tracking-widest text-zinc-400">
            {cards[2].label}
          </span>
        </div>
        <p className="text-sm font-medium text-zinc-200 truncate">
          {cards[2].title}
        </p>
        <p className="text-[11px] text-zinc-500 mt-1 truncate">
          {cards[2].subtle}
        </p>
      </div>

      {/* Mid-right crisp minimal geometric card (echoing white geometric card in reference) */}
      <div className="hidden xl:flex flex-col justify-between absolute top-[42%] right-[4%] w-36 h-44 rounded-2xl border border-white/10 bg-[#F4F4F6]/[0.06] p-4 opacity-35 animate-float-slow">
        <div className="flex items-center justify-between">
          <span className="h-2 w-2 rounded-full bg-white/60" />
          <span className="text-[10px] font-mono text-zinc-400">25:00</span>
        </div>
        <div className="mx-auto my-auto grid grid-cols-2 gap-1.5 opacity-60">
          <div className="w-4 h-4 rounded-full border border-white/50" />
          <div className="w-4 h-4 rounded-full border border-white/50" />
          <div className="w-4 h-4 rounded-full border border-white/50" />
          <div className="w-4 h-4 rounded-full border border-white/50" />
        </div>
        <p className="text-[11px] font-medium text-zinc-300 truncate">
          {cards[3].title}
        </p>
      </div>

      {/* Bottom-left card */}
      <div className="hidden lg:block absolute bottom-16 left-[12%] w-40 rounded-xl border border-white/[0.05] bg-[#121216]/60 p-3.5 opacity-20 animate-float-slow">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">
          {cards[4].label}
        </span>
        <p className="text-sm font-semibold text-zinc-300 mt-1 truncate">
          {cards[4].title}
        </p>
      </div>

      {/* Bottom-right card */}
      <div className="hidden lg:block absolute bottom-14 right-[14%] w-36 rounded-xl border border-white/[0.05] bg-[#121216]/60 p-3.5 opacity-20 animate-float-reverse">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">
          {cards[5].label}
        </span>
        <p className="text-sm font-semibold text-zinc-300 mt-1 truncate">
          {cards[5].title}
        </p>
      </div>
    </div>
  );
}
