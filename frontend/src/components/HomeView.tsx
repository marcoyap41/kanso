'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Layers,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatKansoDate, formatTimerClock } from '@/lib/time';
import type {
  FocusSelection,
  PomodoroPhase,
  PomodoroPreset,
  Project,
  Subtask,
  Task,
  TaskBoard,
  TimerMode,
  User,
} from '@/types/kanso';

interface HomeViewProps {
  user: User;
  boards: TaskBoard[];
  activeBoard: TaskBoard | null;
  activeProject: Project | null;
  activeTask: Task | null;
  activeSubtask: Subtask | null;
  isWorkingMode: boolean;
  onChooseFocusForWork: (next: FocusSelection) => void;
  onRefresh: () => Promise<void>;
  onExitWorkingMode: () => void;
  timerMode: TimerMode;
  pomodoroPreset: PomodoroPreset;
  pomodoroPhase: PomodoroPhase;
  customWorkMinutes: number;
  customBreakMinutes: number;
  displaySeconds: number;
  isRunning: boolean;
  hasActiveSession: boolean;
  onToggleRun: () => void;
  onEndSession: () => void;
  onResetTimer: () => void;
  onChangeTimerConfig: (cfg: {
    mode?: TimerMode;
    preset?: PomodoroPreset;
    customWork?: number;
    customBreak?: number;
  }) => void;
  onCompleteTarget: () => void;
  onPopoutOverlay: () => void;
  onGoToTaskManagement: () => void;
}

/**
 * Radial coordinates (relative to viewport center) for up to 5 Task Boards
 * so they cleanly surround the center greeting cluster on desktop screens.
 */
function getRadialSlot(index: number, total: number): { x: number; y: number } {
  if (total === 1) {
    return { x: 0, y: 205 };
  }
  if (total === 2) {
    return index === 0 ? { x: -290, y: 15 } : { x: 290, y: 15 };
  }
  if (total === 3) {
    const slots = [
      { x: -300, y: -145 },
      { x: 300, y: -145 },
      { x: 0, y: 210 },
    ];
    return slots[index] || { x: 0, y: 210 };
  }
  if (total === 4) {
    const slots = [
      { x: -305, y: -155 },
      { x: 305, y: -155 },
      { x: -335, y: 85 },
      { x: 335, y: 85 },
    ];
    return slots[index] || { x: 0, y: 210 };
  }
  const slots5 = [
    { x: -305, y: -165 },
    { x: 305, y: -165 },
    { x: -350, y: 40 },
    { x: 350, y: 40 },
    { x: 0, y: 215 },
  ];
  return slots5[index] || { x: 0, y: 215 };
}

const REEL_VARIANTS = {
  enter: (dir: number) => ({
    y: dir >= 0 ? '115%' : '-115%',
    opacity: 0,
    rotateX: dir >= 0 ? -35 : 35,
    filter: 'blur(3px)',
  }),
  center: {
    y: '0%',
    opacity: 1,
    rotateX: 0,
    filter: 'blur(0px)',
  },
  exit: (dir: number) => ({
    y: dir >= 0 ? '-115%' : '115%',
    opacity: 0,
    rotateX: dir >= 0 ? 35 : -35,
    filter: 'blur(3px)',
  }),
};

function getHeaderBadgeStyle(color?: string) {
  if (color && color.startsWith('#') && color.length === 7) {
    return {
      color: color,
      backgroundColor: `${color}25`,
      borderColor: `${color}60`,
      boxShadow: `0 0 16px -2px ${color}35`,
    };
  }
  return {
    color: color || '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    boxShadow: '0 0 16px -2px rgba(255, 255, 255, 0.25)',
  };
}

export function HomeView({
  user,
  boards,
  activeBoard,
  activeProject,
  activeTask,
  activeSubtask,
  isWorkingMode,
  onChooseFocusForWork,
  onRefresh,
  onExitWorkingMode,
  timerMode,
  pomodoroPreset,
  pomodoroPhase,
  customWorkMinutes,
  customBreakMinutes,
  displaySeconds,
  isRunning,
  hasActiveSession,
  onToggleRun,
  onEndSession,
  onResetTimer,
  onChangeTimerConfig,
  onCompleteTarget,
  onPopoutOverlay,
  onGoToTaskManagement,
}: HomeViewProps) {
  const [boardsSpreadOpen, setBoardsSpreadOpen] = useState(false);
  const [inspectingBoardId, setInspectingBoardId] = useState<number | null>(
    null
  );
  const [setTimerOpen, setSetTimerOpen] = useState(false);
  const [openPathDropdown, setOpenPathDropdown] = useState<
    'project' | 'task' | 'subtask' | null
  >(null);

  // Lottery / slot-machine reel state for hovering choices in the split board view
  const [[reelState, reelDirection], setReelTuple] = useState<
    [{ key: string; text: string } | null, number]
  >([null, 1]);
  const lastOrderRef = useRef<number>(0);

  const { dayName, formattedDate } = formatKansoDate(new Date());

  // Close spread automatically when entering working mode
  useEffect(() => {
    if (isWorkingMode) {
      setBoardsSpreadOpen(false);
      setInspectingBoardId(null);
    } else {
      setOpenPathDropdown(null);
    }
  }, [isWorkingMode]);

  useEffect(() => {
    setOpenPathDropdown(null);
  }, [activeProject?.id, activeTask?.id, activeSubtask?.id]);

  async function handleToggleTaskDone(task: Task) {
    const nextCompleted = !task.completed;
    await api.updateTask(task.id, { completed: nextCompleted });
    const subsToUpdate = task.subtasks.filter(
      (s) => s.completed !== nextCompleted
    );
    if (subsToUpdate.length > 0) {
      await Promise.all(
        subsToUpdate.map((s) =>
          api.updateSubtask(s.id, { completed: nextCompleted })
        )
      );
    }
    await onRefresh();
  }

  async function handleToggleSubtaskDone(subtask: Subtask) {
    await api.updateSubtask(subtask.id, { completed: !subtask.completed });
    await onRefresh();
  }

  // Reset slot-machine reel whenever switching inspected boards
  useEffect(() => {
    lastOrderRef.current = 0;
    setReelTuple([null, 1]);
  }, [inspectingBoardId]);

  function triggerReel(key: string, text: string, orderIndex: number) {
    setReelTuple(([prev]) => {
      if (prev?.key === key) return [prev, 1];
      const dir = orderIndex >= lastOrderRef.current ? 1 : -1;
      lastOrderRef.current = orderIndex;
      return [{ key, text }, dir];
    });
  }

  function clearReel() {
    setReelTuple(([prev]) => (prev === null ? [null, 1] : [null, -1]));
  }

  const inspectingBoard =
    boards.find((b) => b.id === inspectingBoardId) || null;

  const isTargetCompleted = activeSubtask
    ? activeSubtask.completed
    : activeTask
      ? activeTask.completed
      : false;

  // Build deterministic sequential hover indices for vertical reel direction
  let runningOrder = 0;
  const projectOrderMap = new Map<number, number>();
  const taskOrderMap = new Map<number, number>();
  const subtaskOrderMap = new Map<number, number>();
  if (inspectingBoard) {
    for (const proj of inspectingBoard.projects) {
      projectOrderMap.set(proj.id, ++runningOrder);
      for (const task of proj.tasks) {
        taskOrderMap.set(task.id, ++runningOrder);
        for (const sub of task.subtasks) {
          subtaskOrderMap.set(sub.id, ++runningOrder);
        }
      }
    }
  }

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[calc(100vh-96px)] px-6 py-10 overflow-hidden">
      {isWorkingMode && (
        <button
          type="button"
          onClick={() => {
            setBoardsSpreadOpen(false);
            setInspectingBoardId(null);
            onExitWorkingMode();
          }}
          title="Back to main Home page"
          aria-label="Back to main Home page"
          className="absolute top-5 right-6 sm:top-7 sm:right-10 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-[#141418] hover:border-white/30 hover:bg-white hover:text-[#0A0A0C] text-zinc-400 transition"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      <AnimatePresence mode="wait">
        {!isWorkingMode && !inspectingBoard ? (
          <motion.div
            key="home-idle"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-5xl flex flex-col items-center justify-center min-h-[540px]"
          >
            {/* Stage 1: Minimal Centered Greeting + PLAY button */}
            <div className="relative z-20 text-center flex flex-col items-center">
              <p className="text-xs sm:text-sm font-medium tracking-[0.14em] uppercase text-zinc-500">
                {dayName}, <span className="font-mono">{formattedDate}</span>
              </p>

              <p className="mt-2.5 text-sm sm:text-base text-zinc-400 font-normal">
                Make it yours
              </p>

              <h1 className="mt-2 text-5xl sm:text-7xl font-bold tracking-[-0.04em] leading-[1.03] text-white">
                Hello, {user.name || user.username || user.email.split('@')[0]}
              </h1>

              {/* PLAY Button [hover: start working out] */}
              <div className="mt-9">
                <button
                  type="button"
                  onClick={() => {
                    setInspectingBoardId(null);
                    setBoardsSpreadOpen((prev) => !prev);
                  }}
                  aria-expanded={boardsSpreadOpen}
                  aria-label="start working out"
                  className="group relative inline-flex items-center justify-center gap-0 hover:gap-3 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-100 h-14 min-w-[3.5rem] px-5 font-semibold shadow-[0_0_40px_rgba(255,255,255,0.2)] transition-all duration-300"
                >
                  {boardsSpreadOpen ? (
                    <X className="w-5 h-5 shrink-0" />
                  ) : (
                    <Play className="w-5 h-5 fill-[#0A0A0C] shrink-0" />
                  )}
                  <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-bold tracking-tight opacity-0 group-hover:max-w-[170px] group-hover:opacity-100 transition-all duration-300">
                    {boardsSpreadOpen
                      ? boards.length === 0
                        ? 'close'
                        : 'close boards'
                      : boards.length === 0
                        ? 'no task boards'
                        : 'start working out'}
                  </span>
                </button>
              </div>
            </div>

            {/* Stage 2A: Radial Spread of Task Boards OR Empty Taskboard Prompt */}
            <AnimatePresence>
              {boardsSpreadOpen && boards.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.96 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="relative z-20 mt-8 w-full max-w-md rounded-3xl border border-white/15 bg-[#121216]/95 backdrop-blur-xl p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
                >
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06]">
                    <Layers className="w-5 h-5 text-zinc-300" />
                  </div>
                  <h2 className="text-base font-bold text-white">
                    No task boards yet
                  </h2>
                  <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                    You don&apos;t have any task boards yet. Add your first
                    board in Task Management to start organizing projects and
                    focus sessions.
                  </p>
                  <button
                    type="button"
                    onClick={onGoToTaskManagement}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-5 py-2.5 text-xs font-semibold shadow-[0_0_24px_rgba(255,255,255,0.16)] transition"
                  >
                    <span>Add Task Board in Task Management</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ) : boardsSpreadOpen ? (
                <>
                  {/* Desktop radial spread */}
                  <div className="hidden lg:block pointer-events-none absolute inset-0 z-10">
                    {boards.slice(0, 5).map((board, idx, list) => {
                      const slot = getRadialSlot(idx, list.length);
                      const projectLabel = `${board.projects.length} ${
                        board.projects.length === 1 ? 'project' : 'projects'
                      }`;

                      return (
                        <motion.button
                          key={board.id}
                          type="button"
                          onClick={() => setInspectingBoardId(board.id)}
                          initial={{
                            x: 0,
                            y: 0,
                            scale: 0.35,
                            opacity: 0,
                          }}
                          animate={{
                            x: slot.x,
                            y: slot.y,
                            scale: 1,
                            opacity: 1,
                          }}
                          exit={{
                            x: 0,
                            y: 0,
                            scale: 0.35,
                            opacity: 0,
                          }}
                          transition={{
                            type: 'spring',
                            stiffness: 270,
                            damping: 22,
                            delay: idx * 0.04,
                          }}
                          whileHover={{ scale: 1.05 }}
                          style={{
                            left: '50%',
                            top: '50%',
                            marginLeft: '-112px',
                            marginTop: '-52px',
                          }}
                          className="pointer-events-auto absolute w-56 rounded-2xl border border-white/15 bg-[#121216]/95 hover:border-white/40 hover:bg-[#191920] p-4 text-left backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.75)] transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: board.color }}
                            />
                            <span className="text-[10px] font-mono text-zinc-500">
                              {projectLabel}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-white truncate">
                            {board.name}
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {board.projects.length > 0 ? (
                              board.projects.map((proj) => (
                                <span
                                  key={proj.id}
                                  className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[11px] text-zinc-300"
                                >
                                  {proj.name}
                                </span>
                              ))
                            ) : (
                              <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-zinc-500">
                                No projects yet
                              </span>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Tablet / Mobile responsive grid below center */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    className="lg:hidden relative z-20 mt-8 w-full max-w-md grid grid-cols-1 sm:grid-cols-2 gap-3"
                  >
                    {boards.slice(0, 5).map((board) => {
                      const projectLabel = `${board.projects.length} ${
                        board.projects.length === 1 ? 'project' : 'projects'
                      }`;
                      return (
                        <button
                          key={board.id}
                          type="button"
                          onClick={() => setInspectingBoardId(board.id)}
                          className="rounded-2xl border border-white/15 bg-[#121216]/95 hover:border-white/35 p-4 text-left transition"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: board.color }}
                            />
                            <span className="text-[10px] font-mono text-zinc-500">
                              {projectLabel}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-white truncate">
                            {board.name}
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {board.projects.length > 0 ? (
                              board.projects.map((proj) => (
                                <span
                                  key={proj.id}
                                  className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[11px] text-zinc-300"
                                >
                                  {proj.name}
                                </span>
                              ))
                            ) : (
                              <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-zinc-500">
                                No projects yet
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                </>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : !isWorkingMode && inspectingBoard ? (
          /* Stage 2B: Smooth Split View — Left: Task Board & Project Boxes | Right: "What are we working on?" + Slot-Machine Reel */
          <motion.div
            key={`home-board-${inspectingBoard.id}`}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.98 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start py-4"
          >
            {/* Left Side: Task Board + Prominent Project Boxes */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      clearReel();
                      setInspectingBoardId(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#141418] hover:bg-white hover:text-[#0A0A0C] px-3.5 py-2 text-xs font-medium text-zinc-300 transition shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>All boards</span>
                  </button>

                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: inspectingBoard.color }}
                    />
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-white truncate">
                      {inspectingBoard.name}
                    </h2>
                  </div>
                </div>
              </div>

              {inspectingBoard.projects.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/15 bg-[#111115] p-10 text-center">
                  <p className="text-sm text-zinc-400 mb-4">
                    No projects inside{' '}
                    <strong className="text-white">
                      {inspectingBoard.name}
                    </strong>{' '}
                    yet.
                  </p>
                  <button
                    type="button"
                    onClick={onGoToTaskManagement}
                    className="rounded-full bg-white text-[#0A0A0C] px-5 py-2.5 text-xs font-semibold hover:bg-zinc-200 transition"
                  >
                    Add in Task Management
                  </button>
                </div>
              ) : (
                <div
                  onMouseLeave={clearReel}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                >
                  {inspectingBoard.projects.map((project) => {
                    const projectOrder = projectOrderMap.get(project.id) ?? 1;
                    const defaultTask =
                      project.tasks.find((t) => !t.completed) ||
                      project.tasks[0] ||
                      null;

                    return (
                      <div
                        key={project.id}
                        onMouseEnter={() =>
                          triggerReel(
                            `proj-${project.id}`,
                            project.name,
                            projectOrder
                          )
                        }
                        className="group/box rounded-3xl border border-white/15 bg-[#121216]/95 hover:border-white/40 hover:bg-[#16161C] p-5 sm:p-6 transition-all shadow-[0_20px_60px_rgba(0,0,0,0.6)] flex flex-col justify-between"
                      >
                        {/* Strongly Highlighted Project Title Header */}
                        <div>
                          <button
                            type="button"
                            onMouseEnter={() =>
                              triggerReel(
                                `proj-${project.id}`,
                                project.name,
                                projectOrder
                              )
                            }
                            onClick={() => {
                              if (defaultTask) {
                                onChooseFocusForWork({
                                  boardId: inspectingBoard.id,
                                  projectId: project.id,
                                  taskId: defaultTask.id,
                                  subtaskId: null,
                                });
                              } else {
                                onGoToTaskManagement();
                              }
                            }}
                            className="w-full text-left group/proj focus:outline-none"
                          >
                            <div
                              className="h-1.5 w-10 rounded-full mb-3.5 transition-all duration-300 group-hover/box:w-16"
                              style={{ backgroundColor: inspectingBoard.color }}
                            />
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-xl sm:text-2xl font-extrabold tracking-[-0.03em] text-white leading-snug group-hover/proj:text-zinc-100 transition">
                                {project.name}
                              </h3>
                              <span className="mt-1 rounded-full border border-white/10 bg-[#1B1B22] px-2.5 py-0.5 text-[10px] font-mono text-zinc-400 shrink-0">
                                {project.tasks.length} task
                                {project.tasks.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            {project.description && (
                              <p className="mt-1.5 text-xs text-zinc-500 line-clamp-2">
                                {project.description}
                              </p>
                            )}
                          </button>

                          {/* Interactive Tasks & Optional Subtasks inside Project Box */}
                          <div className="mt-4 pt-3.5 border-t border-white/[0.08] space-y-2">
                            {project.tasks.length === 0 ? (
                              <p className="text-xs text-zinc-600">
                                No tasks yet.
                              </p>
                            ) : (
                              project.tasks.map((task) => {
                                const taskOrder =
                                  taskOrderMap.get(task.id) ?? projectOrder;

                                return (
                                  <div
                                    key={task.id}
                                    className="rounded-xl border border-white/[0.07] bg-[#0B0B0E] hover:border-white/30 hover:bg-white/[0.05] transition"
                                  >
                                    <div
                                      onMouseEnter={(e) => {
                                        e.stopPropagation();
                                        triggerReel(
                                          `task-${task.id}`,
                                          `${project.name} > ${task.title}`,
                                          taskOrder
                                        );
                                      }}
                                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5"
                                    >
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleToggleTaskDone(task);
                                        }}
                                        title={
                                          task.completed
                                            ? 'Unmark task as done'
                                            : 'Mark task as done'
                                        }
                                        aria-label={
                                          task.completed
                                            ? `Unmark ${task.title} as done`
                                            : `Mark ${task.title} as done`
                                        }
                                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                          task.completed
                                            ? 'border-emerald-400 bg-emerald-400 text-[#0A0A0C]'
                                            : 'border-white/30 hover:border-white'
                                        }`}
                                      >
                                        {task.completed && (
                                          <Check className="w-3 h-3 stroke-[3]" />
                                        )}
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          onChooseFocusForWork({
                                            boardId: inspectingBoard.id,
                                            projectId: project.id,
                                            taskId: task.id,
                                            subtaskId: null,
                                          })
                                        }
                                        className="flex-1 min-w-0 flex items-center justify-between gap-2.5 text-left group/task"
                                      >
                                        <span
                                          className={`text-sm font-medium truncate transition ${
                                            task.completed
                                              ? 'line-through text-zinc-500'
                                              : 'text-zinc-200 group-hover/task:text-white'
                                          }`}
                                        >
                                          {task.title}
                                        </span>
                                        <Play className="w-3 h-3 text-zinc-500 group-hover/task:text-white fill-current shrink-0 transition" />
                                      </button>
                                    </div>

                                    {task.subtasks.length > 0 && (
                                      <div className="px-3 pb-2.5 pt-1 border-t border-white/[0.05] space-y-1">
                                        {task.subtasks.map((sub) => {
                                          const subOrder =
                                            subtaskOrderMap.get(sub.id) ??
                                            taskOrder;

                                          return (
                                            <div
                                              key={sub.id}
                                              onMouseEnter={(e) => {
                                                e.stopPropagation();
                                                triggerReel(
                                                  `sub-${sub.id}`,
                                                  `${project.name} > ${task.title} > ${sub.title}`,
                                                  subOrder
                                                );
                                              }}
                                              className="group/sub w-full flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-white/[0.07] hover:text-white transition"
                                            >
                                              <span
                                                aria-hidden="true"
                                                className="text-zinc-500 select-none shrink-0"
                                              >
                                                •
                                              </span>

                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void handleToggleSubtaskDone(
                                                    sub
                                                  );
                                                }}
                                                title={
                                                  sub.completed
                                                    ? 'Unmark subtask as done'
                                                    : 'Mark subtask as done'
                                                }
                                                aria-label={
                                                  sub.completed
                                                    ? `Unmark ${sub.title} as done`
                                                    : `Mark ${sub.title} as done`
                                                }
                                                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition ${
                                                  sub.completed
                                                    ? 'border-emerald-400 bg-emerald-400 text-[#0A0A0C]'
                                                    : 'border-white/25 hover:border-white'
                                                }`}
                                              >
                                                {sub.completed && (
                                                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                                                )}
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() =>
                                                  onChooseFocusForWork({
                                                    boardId: inspectingBoard.id,
                                                    projectId: project.id,
                                                    taskId: task.id,
                                                    subtaskId: sub.id,
                                                  })
                                                }
                                                className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left"
                                              >
                                                <span
                                                  className={`truncate ${
                                                    sub.completed
                                                      ? 'line-through text-zinc-600'
                                                      : ''
                                                  }`}
                                                >
                                                  {sub.title}
                                                </span>
                                                <Play className="w-2.5 h-2.5 text-zinc-500 group-hover/sub:text-white fill-current shrink-0 transition" />
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Side: "What are we working on?" + Slot-Machine Vertical Text Reel */}
            <div className="lg:col-span-5 lg:sticky lg:top-28 flex flex-col justify-center min-h-[220px] lg:min-h-[440px]">
              <h2 className="text-3xl sm:text-5xl font-bold tracking-[-0.04em] leading-[1.08] text-white">
                What are we
                <br />
                working on?
              </h2>

              {/* Lottery / Slot-Machine Blank Fill */}
              <div className="relative mt-6 min-h-[4.5rem] sm:min-h-[5.5rem] overflow-hidden border-b-2 border-white/25 flex items-center [perspective:800px]">
                <AnimatePresence
                  mode="popLayout"
                  custom={reelDirection}
                  initial={false}
                >
                  <motion.div
                    key={reelState?.key ?? 'blank'}
                    custom={reelDirection}
                    variants={REEL_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      type: 'spring',
                      stiffness: 380,
                      damping: 28,
                      mass: 0.7,
                    }}
                    className="w-full py-2"
                  >
                    {reelState ? (
                      <div className="text-xl sm:text-3xl font-bold tracking-[-0.02em] text-white leading-tight flex flex-wrap items-center gap-x-2 gap-y-1">
                        {reelState.text.split(' > ').map((part, idx, arr) => (
                          <React.Fragment key={idx}>
                            <span
                              className={
                                idx === arr.length - 1
                                  ? 'text-white'
                                  : 'text-zinc-400'
                              }
                            >
                              {part}
                            </span>
                            {idx < arr.length - 1 && (
                              <span
                                className="font-mono text-lg sm:text-2xl"
                                style={{ color: inspectingBoard.color }}
                              >
                                &gt;
                              </span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      <span className="text-2xl sm:text-3xl font-mono text-zinc-700 tracking-widest select-none">
                        _______
                      </span>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Stage 3: Main Page Working Mode */
          <motion.div
            key="home-working"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-2xl mx-auto text-center flex flex-col items-center"
          >
            {/* Top directory path: clickable Task Board name -> goes back to choose on task board tab */}
            <div className="flex items-center justify-center mb-3">
              <button
                type="button"
                onClick={() => {
                  setOpenPathDropdown(null);
                  if (activeBoard) {
                    setBoardsSpreadOpen(true);
                    setInspectingBoardId(activeBoard.id);
                  } else {
                    setBoardsSpreadOpen(true);
                  }
                  onExitWorkingMode();
                }}
                title="Open task board selection"
                className="inline-flex items-center gap-2 rounded-full border border-transparent hover:border-white/15 hover:bg-white/[0.04] px-3 py-1 text-xs text-zinc-400 hover:text-white transition"
              >
                {activeBoard && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: activeBoard.color }}
                  />
                )}
                <span>{activeBoard?.name || 'Focus session'}</span>
              </button>
            </div>

            {/* Working on [projectname] > [taskname] > [subtaskname:ifany] + Direct Segment Switcher */}
            <div className="relative flex flex-col items-center">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <h1 className="text-2xl sm:text-4xl font-bold tracking-[-0.03em] text-white flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                  <span>Working on</span>

                  {activeProject ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenPathDropdown((prev) =>
                          prev === 'project' ? null : 'project'
                        )
                      }
                      style={{ color: activeBoard?.color || '#FFFFFF' }}
                      title={`Switch project in ${activeBoard?.name || 'board'}`}
                      className={`rounded-lg px-2 py-0.5 -mx-1 underline-offset-4 transition focus:outline-none ${
                        openPathDropdown === 'project'
                          ? 'bg-white/10 ring-1 ring-white/25 underline font-bold'
                          : 'hover:bg-white/[0.06] hover:underline'
                      }`}
                    >
                      {activeProject.name}
                    </button>
                  ) : (
                    <span style={{ color: activeBoard?.color || '#FFFFFF' }}>
                      Focus Session
                    </span>
                  )}

                  {activeTask && (
                    <>
                      <span className="text-zinc-600 font-mono">&gt;</span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPathDropdown((prev) =>
                            prev === 'task' ? null : 'task'
                          )
                        }
                        style={{ color: activeBoard?.color || '#FFFFFF' }}
                        title={`Switch task in ${activeProject?.name || 'project'}`}
                        className={`rounded-lg px-2 py-0.5 -mx-1 underline-offset-4 transition focus:outline-none ${
                          openPathDropdown === 'task'
                            ? 'bg-white/10 ring-1 ring-white/25 underline font-bold'
                            : 'hover:bg-white/[0.06] hover:underline'
                        }`}
                      >
                        {activeTask.title}
                      </button>
                    </>
                  )}

                  {activeSubtask && (
                    <>
                      <span className="text-zinc-600 font-mono">&gt;</span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPathDropdown((prev) =>
                            prev === 'subtask' ? null : 'subtask'
                          )
                        }
                        style={{ color: activeBoard?.color || '#FFFFFF' }}
                        title={`Switch subtask in ${activeTask?.title || 'task'}`}
                        className={`rounded-lg px-2 py-0.5 -mx-1 underline-offset-4 transition focus:outline-none ${
                          openPathDropdown === 'subtask'
                            ? 'bg-white/10 ring-1 ring-white/25 underline font-bold'
                            : 'hover:bg-white/[0.06] hover:underline'
                        }`}
                      >
                        {activeSubtask.title}
                      </button>
                    </>
                  )}
                </h1>

                {isTargetCompleted && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Marked as Done</span>
                  </span>
                )}
              </div>

              {/* Inline Direct Directory Switcher Dropdown */}
              <AnimatePresence>
                {openPathDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.18 }}
                    className="mt-4 w-full max-w-sm rounded-2xl border border-white/15 bg-[#121216]/95 backdrop-blur-xl p-2 shadow-[0_24px_80px_rgba(0,0,0,0.85)] text-left z-40"
                  >
                    {openPathDropdown === 'project' && activeBoard && (
                      <div className="space-y-1">
                        <div className="px-3 py-2 mb-1.5 flex items-center flex-wrap gap-1.5 border-b border-white/10">
                          <span
                            className="px-2 py-0.5 rounded-md font-black tracking-wider text-xs border"
                            style={getHeaderBadgeStyle(activeBoard.color)}
                          >
                            PROJECTS
                          </span>
                          <span className="font-bold text-zinc-300 text-[11px] tracking-wider uppercase">
                            IN
                          </span>
                          <span
                            className="font-bold truncate text-xs"
                            style={{ color: activeBoard.color || '#FFFFFF' }}
                          >
                            {activeBoard.name}
                          </span>
                        </div>
                        {activeBoard.projects.map((proj) => {
                          const targetTask =
                            proj.tasks.find((t) => !t.completed) ||
                            proj.tasks[0] ||
                            null;
                          const isCurrent = proj.id === activeProject?.id;
                          return (
                            <button
                              key={proj.id}
                              type="button"
                              disabled={!targetTask}
                              onClick={() => {
                                if (!targetTask) return;
                                setOpenPathDropdown(null);
                                onChooseFocusForWork({
                                  boardId: activeBoard.id,
                                  projectId: proj.id,
                                  taskId: targetTask.id,
                                  subtaskId: null,
                                });
                              }}
                              className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs transition ${
                                isCurrent
                                  ? 'bg-white text-[#0A0A0C] font-semibold'
                                  : 'text-zinc-200 hover:bg-white/[0.08] disabled:opacity-40'
                              }`}
                            >
                              <span className="truncate">{proj.name}</span>
                              <span
                                className={`text-[10px] font-mono shrink-0 ${
                                  isCurrent ? 'text-zinc-700' : 'text-zinc-500'
                                }`}
                              >
                                {proj.tasks.length}t
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {openPathDropdown === 'task' &&
                      activeBoard &&
                      activeProject && (
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          <div className="px-3 py-2 mb-1.5 flex items-center flex-wrap gap-1.5 border-b border-white/10">
                            <span
                              className="px-2 py-0.5 rounded-md font-black tracking-wider text-xs border"
                              style={getHeaderBadgeStyle(activeBoard?.color)}
                            >
                              TASKS
                            </span>
                            <span className="font-bold text-zinc-300 text-[11px] tracking-wider uppercase">
                              IN
                            </span>
                            <span className="font-bold text-white truncate text-xs">
                              {activeProject.name}
                            </span>
                          </div>
                          {activeProject.tasks.map((task) => {
                            const isCurrent =
                              task.id === activeTask?.id && !activeSubtask;
                            return (
                              <div key={task.id} className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenPathDropdown(null);
                                    onChooseFocusForWork({
                                      boardId: activeBoard.id,
                                      projectId: activeProject.id,
                                      taskId: task.id,
                                      subtaskId: null,
                                    });
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs transition ${
                                    isCurrent
                                      ? 'bg-white text-[#0A0A0C] font-semibold'
                                      : 'text-zinc-200 hover:bg-white/[0.08]'
                                  }`}
                                >
                                  <span
                                    className={`truncate ${
                                      task.completed ? 'line-through opacity-70' : ''
                                    }`}
                                  >
                                    {task.title}
                                  </span>
                                  {task.subtasks.length > 0 && (
                                    <span
                                      className={`text-[10px] font-mono shrink-0 ${
                                        isCurrent
                                          ? 'text-zinc-700'
                                          : 'text-zinc-500'
                                      }`}
                                    >
                                      {task.subtasks.length} sub
                                    </span>
                                  )}
                                </button>

                                {task.subtasks.length > 0 && (
                                  <div className="pl-4 space-y-0.5">
                                    {task.subtasks.map((sub) => {
                                      const isCurrentSub =
                                        sub.id === activeSubtask?.id;
                                      return (
                                        <button
                                          key={sub.id}
                                          type="button"
                                          onClick={() => {
                                            setOpenPathDropdown(null);
                                            onChooseFocusForWork({
                                              boardId: activeBoard.id,
                                              projectId: activeProject.id,
                                              taskId: task.id,
                                              subtaskId: sub.id,
                                            });
                                          }}
                                          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition ${
                                            isCurrentSub
                                              ? 'bg-white text-[#0A0A0C] font-semibold'
                                              : 'text-zinc-400 hover:bg-white/[0.08] hover:text-white'
                                          }`}
                                        >
                                          <span className="opacity-60">•</span>
                                          <span
                                            className={`truncate ${
                                              sub.completed
                                                ? 'line-through opacity-70'
                                                : ''
                                            }`}
                                          >
                                            {sub.title}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                    {openPathDropdown === 'subtask' &&
                      activeBoard &&
                      activeProject &&
                      activeTask && (
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          <div className="px-3 py-2 mb-1.5 flex items-center flex-wrap gap-1.5 border-b border-white/10">
                            <span
                              className="px-2 py-0.5 rounded-md font-black tracking-wider text-xs border"
                              style={getHeaderBadgeStyle(activeBoard?.color)}
                            >
                              SUBTASKS
                            </span>
                            <span className="font-bold text-zinc-300 text-[11px] tracking-wider uppercase">
                              IN
                            </span>
                            <span className="font-bold text-white truncate text-xs">
                              {activeTask.title}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenPathDropdown(null);
                              onChooseFocusForWork({
                                boardId: activeBoard.id,
                                projectId: activeProject.id,
                                taskId: activeTask.id,
                                subtaskId: null,
                              });
                            }}
                            className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.08] transition"
                          >
                            <span className="truncate">
                              Whole task: {activeTask.title}
                            </span>
                          </button>

                          {activeTask.subtasks.map((sub) => {
                            const isCurrent = sub.id === activeSubtask?.id;
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => {
                                  setOpenPathDropdown(null);
                                  onChooseFocusForWork({
                                    boardId: activeBoard.id,
                                    projectId: activeProject.id,
                                    taskId: activeTask.id,
                                    subtaskId: sub.id,
                                  });
                                }}
                                className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition ${
                                  isCurrent
                                    ? 'bg-white text-[#0A0A0C] font-semibold'
                                    : 'text-zinc-200 hover:bg-white/[0.08]'
                                }`}
                              >
                                <span className="opacity-60">•</span>
                                <span
                                  className={`truncate ${
                                    sub.completed ? 'line-through opacity-70' : ''
                                  }`}
                                >
                                  {sub.title}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Centered Large Timer */}
            <div className="my-8 sm:my-10">
              <div className="text-7xl sm:text-8xl font-mono font-bold tracking-tight text-white tabular-nums leading-none">
                {formatTimerClock(displaySeconds)}
              </div>
              <p className="mt-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
                {timerMode === 'pomodoro'
                  ? `Pomodoro ${
                      pomodoroPreset === 'custom'
                        ? `${customWorkMinutes}:${customBreakMinutes}`
                        : pomodoroPreset
                    } · ${pomodoroPhase === 'work' ? 'Focus' : 'Break'}`
                  : 'Normal Timer'}
              </p>
            </div>

            {/* Controls: Play button [start working], set timer, plus icon-only Reset, Pop out, Mark/Unmark Done */}
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onToggleRun}
                aria-label={isRunning ? 'pause' : 'start working'}
                className="group inline-flex items-center justify-center gap-2.5 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 h-14 px-7 text-sm font-semibold shadow-[0_0_36px_rgba(255,255,255,0.18)] transition"
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4 fill-[#0A0A0C]" />
                    <span>pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-[#0A0A0C]" />
                    <span>start working</span>
                  </>
                )}
              </button>

              {hasActiveSession && (
                <button
                  type="button"
                  onClick={onEndSession}
                  aria-label="end session"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-rose-400/35 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 h-14 px-6 text-sm font-semibold transition"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>end session</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSetTimerOpen((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-full border h-14 px-6 text-sm font-medium transition ${
                  setTimerOpen
                    ? 'border-white/35 bg-[#1D1D24] text-white'
                    : 'border-white/10 bg-[#15151A] hover:border-white/25 text-zinc-200'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4 text-zinc-400" />
                <span>set timer</span>
              </button>

              <button
                type="button"
                onClick={onResetTimer}
                title="Reset timer"
                aria-label="Reset timer"
                className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#15151A] hover:border-white/25 text-zinc-300 hover:text-white transition"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onPopoutOverlay}
                title="Pop out overlay"
                aria-label="Pop out overlay"
                className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#15151A] hover:border-white/25 text-zinc-300 hover:text-white transition"
              >
                <ExternalLink className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onCompleteTarget}
                disabled={!activeTask}
                title={isTargetCompleted ? 'Unmark as Done' : 'Mark as Done'}
                aria-label={
                  isTargetCompleted ? 'Unmark as Done' : 'Mark as Done'
                }
                className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition ${
                  isTargetCompleted
                    ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'border-white/10 bg-[#15151A] hover:border-emerald-400/40 hover:bg-emerald-500/15 text-zinc-300 hover:text-emerald-300 disabled:opacity-40'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
            </div>

            {/* Compact Set Timer Drawer (mode & duration configuration only) */}
            <AnimatePresence initial={false}>
              {setTimerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="w-full max-w-md overflow-hidden mt-5"
                >
                  <div className="rounded-3xl border border-white/10 bg-[#121216] p-5 space-y-4 text-left">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {(['25:5', '50:10', 'custom'] as PomodoroPreset[]).map(
                        (preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() =>
                              onChangeTimerConfig({ mode: 'pomodoro', preset })
                            }
                            className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition ${
                              timerMode === 'pomodoro' &&
                              pomodoroPreset === preset
                                ? 'bg-white text-[#0A0A0C] border-white font-semibold'
                                : 'bg-[#18181E] text-zinc-300 border-white/10 hover:border-white/25'
                            }`}
                          >
                            {preset === 'custom'
                              ? 'Custom'
                              : `Pomodoro ${preset}`}
                          </button>
                        )
                      )}

                      <button
                        type="button"
                        onClick={() => onChangeTimerConfig({ mode: 'normal' })}
                        className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition ${
                          timerMode === 'normal'
                            ? 'bg-white text-[#0A0A0C] border-white font-semibold'
                            : 'bg-[#18181E] text-zinc-300 border-white/10 hover:border-white/25'
                        }`}
                      >
                        Normal Timer
                      </button>
                    </div>

                    {timerMode === 'pomodoro' && pomodoroPreset === 'custom' && (
                      <div className="flex items-center justify-center gap-2 text-xs text-zinc-300">
                        <span className="text-zinc-500">Work</span>
                        <input
                          type="number"
                          min={1}
                          max={180}
                          value={customWorkMinutes}
                          onChange={(e) =>
                            onChangeTimerConfig({
                              customWork: Math.max(
                                1,
                                Math.min(180, Number(e.target.value) || 25)
                              ),
                            })
                          }
                          className="w-14 rounded-lg border border-white/15 bg-[#0A0A0C] px-2 py-1 text-center font-mono text-white focus:outline-none"
                        />
                        <span className="text-zinc-500">: Break</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={customBreakMinutes}
                          onChange={(e) =>
                            onChangeTimerConfig({
                              customBreak: Math.max(
                                1,
                                Math.min(60, Number(e.target.value) || 5)
                              ),
                            })
                          }
                          className="w-14 rounded-lg border border-white/15 bg-[#0A0A0C] px-2 py-1 text-center font-mono text-white focus:outline-none"
                        />
                        <span className="text-zinc-500">min</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
