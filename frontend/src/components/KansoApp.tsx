'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, LogOut, Timer } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTimerClock, playZenChime } from '@/lib/time';
import type {
  FocusSelection,
  PageIndex,
  PomodoroPhase,
  PomodoroPreset,
  TaskBoard,
  TimerMode,
  User,
} from '@/types/kanso';
import { CalendarView } from './CalendarView';
import { HomeView } from './HomeView';
import { KansoLogo } from './KansoLogo';
import { TaskManagementView } from './TaskManagementView';
import { TimerOverlay, type TimerOverlayHandle } from './TimerOverlay';

interface KansoAppProps {
  user: User;
  onLogout: () => void;
}

const PAGE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction > 0 ? 110 : -110,
    opacity: 0,
    scale: 0.985,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -110 : 110,
    opacity: 0,
    scale: 0.985,
  }),
};

function getPomodoroDurations(
  preset: PomodoroPreset,
  customWork: number,
  customBreak: number
): { workSeconds: number; breakSeconds: number } {
  if (preset === '25:5') {
    return { workSeconds: 25 * 60, breakSeconds: 5 * 60 };
  }
  if (preset === '50:10') {
    return { workSeconds: 50 * 60, breakSeconds: 10 * 60 };
  }
  return {
    workSeconds: Math.max(1, customWork) * 60,
    breakSeconds: Math.max(1, customBreak) * 60,
  };
}

export function KansoApp({ user, onLogout }: KansoAppProps) {
  // Spatial navigation: 0 (Task Management) <- 1 (Home) -> 2 (Calendar)
  const [[pageIndex, direction], setPageTuple] = useState<[PageIndex, number]>([
    1, 0,
  ]);

  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [loadingHierarchy, setLoadingHierarchy] = useState(true);
  const [selection, setSelection] = useState<FocusSelection>({
    boardId: null,
    projectId: null,
    taskId: null,
    subtaskId: null,
  });

  // Main page working mode + optional floating overlay state
  const [isWorkingMode, setIsWorkingMode] = useState(false);
  const [forceOverlay, setForceOverlay] = useState(false);

  // Persistent timer state across views
  const [timerMode, setTimerMode] = useState<TimerMode>('pomodoro');
  const [pomodoroPreset, setPomodoroPreset] = useState<PomodoroPreset>('25:5');
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>('work');
  const [customWorkMinutes, setCustomWorkMinutes] = useState(25);
  const [customBreakMinutes, setCustomBreakMinutes] = useState(5);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const timerOverlayRef = useRef<TimerOverlayHandle | null>(null);
  const unsyncedSecondsRef = useRef(0);
  const activeTargetRef = useRef<{
    taskId: number | null;
    subtaskId: number | null;
  }>({ taskId: null, subtaskId: null });

  const navigateTo = useCallback((nextPage: PageIndex) => {
    setPageTuple(([current]) => {
      if (current === nextPage) return [current, 0];
      return [nextPage, nextPage > current ? 1 : -1];
    });
  }, []);

  const refreshHierarchy = useCallback(async () => {
    try {
      const data = await api.getHierarchy();
      setBoards(data.boards);

      setSelection((prev) => {
        const board =
          data.boards.find((b) => b.id === prev.boardId) ||
          data.boards[0] ||
          null;
        const project =
          board?.projects.find((p) => p.id === prev.projectId) ||
          board?.projects[0] ||
          null;
        const task =
          project?.tasks.find((t) => t.id === prev.taskId) ||
          project?.tasks[0] ||
          null;
        const subtask =
          task?.subtasks.find((s) => s.id === prev.subtaskId) ||
          (prev.subtaskId === null && prev.taskId === task?.id
            ? null
            : task?.subtasks.find((s) => !s.completed) ||
              task?.subtasks[0] ||
              null);

        return {
          boardId: board?.id ?? null,
          projectId: project?.id ?? null,
          taskId: task?.id ?? null,
          subtaskId: subtask?.id ?? null,
        };
      });
    } catch (err) {
      console.error('Failed to load hierarchy:', err);
    } finally {
      setLoadingHierarchy(false);
    }
  }, []);

  useEffect(() => {
    refreshHierarchy();
  }, [refreshHierarchy]);

  useEffect(() => {
    activeTargetRef.current = {
      taskId: selection.taskId,
      subtaskId: selection.subtaskId,
    };
  }, [selection.taskId, selection.subtaskId]);

  const flushWorkedSeconds = useCallback(async () => {
    const delta = unsyncedSecondsRef.current;
    if (delta <= 0) return;

    const { taskId, subtaskId } = activeTargetRef.current;
    if (!taskId && !subtaskId) {
      unsyncedSecondsRef.current = 0;
      return;
    }

    unsyncedSecondsRef.current = 0;
    try {
      if (subtaskId) {
        await api.updateSubtask(subtaskId, { add_seconds: delta });
      } else if (taskId) {
        await api.updateTask(taskId, { add_seconds: delta });
      }
      await refreshHierarchy();
    } catch {
      unsyncedSecondsRef.current += delta;
    }
  }, [refreshHierarchy]);

  // Keyboard Alt+ArrowLeft / Alt+ArrowRight page switching
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateTo(Math.max(0, pageIndex - 1) as PageIndex);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateTo(Math.min(2, pageIndex + 1) as PageIndex);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateTo, pageIndex]);

  // 1-second timer tick loop
  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      if (timerMode === 'normal') {
        setElapsedSeconds((prev) => prev + 1);
        unsyncedSecondsRef.current += 1;
      } else {
        if (pomodoroPhase === 'work') {
          unsyncedSecondsRef.current += 1;
        }
        setRemainingSeconds((prev) => {
          if (prev > 1) return prev - 1;

          playZenChime();
          const { workSeconds, breakSeconds } = getPomodoroDurations(
            pomodoroPreset,
            customWorkMinutes,
            customBreakMinutes
          );
          if (pomodoroPhase === 'work') {
            setPomodoroPhase('break');
            void flushWorkedSeconds();
            return breakSeconds;
          } else {
            setPomodoroPhase('work');
            return workSeconds;
          }
        });
      }

      if (unsyncedSecondsRef.current >= 15) {
        void flushWorkedSeconds();
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    isRunning,
    timerMode,
    pomodoroPhase,
    pomodoroPreset,
    customWorkMinutes,
    customBreakMinutes,
    flushWorkedSeconds,
  ]);

  useEffect(() => {
    if (!isRunning) {
      void flushWorkedSeconds();
    }
  }, [isRunning, flushWorkedSeconds]);

  const resolved = useMemo(() => {
    const board =
      boards.find((b) => b.id === selection.boardId) || boards[0] || null;
    const project =
      board?.projects.find((p) => p.id === selection.projectId) ||
      board?.projects[0] ||
      null;
    const task =
      project?.tasks.find((t) => t.id === selection.taskId) ||
      project?.tasks[0] ||
      null;
    const subtask =
      task?.subtasks.find((s) => s.id === selection.subtaskId) || null;
    return { board, project, task, subtask };
  }, [boards, selection]);

  const handleChangeTimerConfig = useCallback(
    (cfg: {
      mode?: TimerMode;
      preset?: PomodoroPreset;
      customWork?: number;
      customBreak?: number;
    }) => {
      const nextMode = cfg.mode ?? timerMode;
      const nextPreset = cfg.preset ?? pomodoroPreset;
      const nextWork = cfg.customWork ?? customWorkMinutes;
      const nextBreak = cfg.customBreak ?? customBreakMinutes;

      setTimerMode(nextMode);
      setPomodoroPreset(nextPreset);
      setCustomWorkMinutes(nextWork);
      setCustomBreakMinutes(nextBreak);

      if (nextMode === 'pomodoro') {
        const { workSeconds, breakSeconds } = getPomodoroDurations(
          nextPreset,
          nextWork,
          nextBreak
        );
        setRemainingSeconds(
          pomodoroPhase === 'work' ? workSeconds : breakSeconds
        );
      }
    },
    [
      timerMode,
      pomodoroPreset,
      customWorkMinutes,
      customBreakMinutes,
      pomodoroPhase,
    ]
  );

  const handleResetTimer = useCallback(() => {
    setIsRunning(false);
    void flushWorkedSeconds();
    if (timerMode === 'normal') {
      setElapsedSeconds(0);
    } else {
      const { workSeconds } = getPomodoroDurations(
        pomodoroPreset,
        customWorkMinutes,
        customBreakMinutes
      );
      setPomodoroPhase('work');
      setRemainingSeconds(workSeconds);
    }
  }, [
    flushWorkedSeconds,
    timerMode,
    pomodoroPreset,
    customWorkMinutes,
    customBreakMinutes,
  ]);

  const handleChooseFocusForWork = useCallback(
    async (nextSelection: FocusSelection, autoStart = false) => {
      setIsRunning(false);
      await flushWorkedSeconds();
      setSelection(nextSelection);
      activeTargetRef.current = {
        taskId: nextSelection.taskId,
        subtaskId: nextSelection.subtaskId,
      };
      if (timerMode === 'normal') {
        setElapsedSeconds(0);
      } else {
        const { workSeconds } = getPomodoroDurations(
          pomodoroPreset,
          customWorkMinutes,
          customBreakMinutes
        );
        setPomodoroPhase('work');
        setRemainingSeconds(workSeconds);
      }
      setIsWorkingMode(true);
      navigateTo(1);
      if (autoStart) {
        setIsRunning(true);
      }
    },
    [
      flushWorkedSeconds,
      timerMode,
      pomodoroPreset,
      customWorkMinutes,
      customBreakMinutes,
      navigateTo,
    ]
  );

  const handleExitWorkingMode = useCallback(() => {
    setIsRunning(false);
    setForceOverlay(false);
    void flushWorkedSeconds();
    setIsWorkingMode(false);
  }, [flushWorkedSeconds]);

  const handleCompleteTarget = useCallback(async () => {
    if (resolved.subtask) {
      const nextCompleted = !resolved.subtask.completed;
      if (nextCompleted) {
        setIsRunning(false);
        await flushWorkedSeconds();
      }
      await api.updateSubtask(resolved.subtask.id, {
        completed: nextCompleted,
      });
    } else if (resolved.task) {
      const nextCompleted = !resolved.task.completed;
      if (nextCompleted) {
        setIsRunning(false);
        await flushWorkedSeconds();
      }
      await api.updateTask(resolved.task.id, { completed: nextCompleted });
    }
    await refreshHierarchy();
  }, [flushWorkedSeconds, resolved.subtask, resolved.task, refreshHierarchy]);

  const displaySeconds =
    timerMode === 'pomodoro' ? remainingSeconds : elapsedSeconds;

  const overlayVisible =
    (isWorkingMode && pageIndex !== 1) || forceOverlay;

  return (
    <div className="relative min-h-screen bg-[#0A0A0C] text-white flex flex-col overflow-x-hidden">
      {/* Top Navigation Bar */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-5 sm:px-10 py-5 border-b border-white/[0.06] bg-[#0A0A0C]/80 backdrop-blur-md">
        <KansoLogo onClick={() => navigateTo(1)} />

        {/* Center Spatial Switcher: Task Management <- Home -> Calendar */}
        <nav
          aria-label="Primary sections"
          className="order-3 sm:order-2 w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 rounded-full border border-white/10 bg-[#121216]/90 p-1"
        >
          <button
            type="button"
            onClick={() => navigateTo(0)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              pageIndex === 0
                ? 'bg-white text-[#0A0A0C] font-semibold shadow-[0_0_18px_rgba(255,255,255,0.14)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {pageIndex > 0 && <ArrowLeft className="w-3 h-3 opacity-60" />}
            <span>Task Management</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo(1)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
              pageIndex === 1
                ? 'bg-white text-[#0A0A0C] font-semibold shadow-[0_0_18px_rgba(255,255,255,0.14)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Home
          </button>

          <button
            type="button"
            onClick={() => navigateTo(2)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              pageIndex === 2
                ? 'bg-white text-[#0A0A0C] font-semibold shadow-[0_0_18px_rgba(255,255,255,0.14)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <span>Calendar</span>
            {pageIndex < 2 && <ArrowRight className="w-3 h-3 opacity-60" />}
          </button>
        </nav>

        {/* Right Controls: Live Timer Pill (only when active) + User & Logout */}
        <div className="order-2 sm:order-3 flex items-center gap-2.5">
          {isWorkingMode && (
            <button
              type="button"
              onClick={() => setForceOverlay((prev) => !prev)}
              title="Toggle floating timer widget"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#17171D] hover:border-white/30 px-3.5 py-1.5 text-xs font-mono text-white transition"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                }`}
              />
              <Timer className="w-3.5 h-3.5 text-zinc-400" />
              <span>{formatTimerClock(displaySeconds)}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsRunning(false);
              void flushWorkedSeconds();
              onLogout();
            }}
            title="Sign out"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#141418] hover:bg-white hover:text-[#0A0A0C] px-4 py-1.5 text-xs font-medium text-zinc-200 transition"
          >
            <span>{user.username}</span>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Smooth Horizontal Page Transition Container */}
      <main className="relative z-10 flex-1 overflow-x-hidden">
        {loadingHierarchy ? (
          <div className="flex min-h-[calc(100vh-120px)] items-center justify-center">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-white animate-ping" />
              <span>Loading kanso</span>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={pageIndex}
              custom={direction}
              variants={PAGE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                duration: 0.34,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {pageIndex === 0 && (
                <TaskManagementView
                  boards={boards}
                  onRefresh={refreshHierarchy}
                  onStartWork={(sel) => void handleChooseFocusForWork(sel, true)}
                />
              )}

              {pageIndex === 1 && (
                <HomeView
                  user={user}
                  boards={boards}
                  activeBoard={resolved.board}
                  activeProject={resolved.project}
                  activeTask={resolved.task}
                  activeSubtask={resolved.subtask}
                  isWorkingMode={isWorkingMode}
                  onChooseFocusForWork={(sel) =>
                    void handleChooseFocusForWork(sel, false)
                  }
                  onRefresh={refreshHierarchy}
                  onExitWorkingMode={handleExitWorkingMode}
                  timerMode={timerMode}
                  pomodoroPreset={pomodoroPreset}
                  pomodoroPhase={pomodoroPhase}
                  customWorkMinutes={customWorkMinutes}
                  customBreakMinutes={customBreakMinutes}
                  displaySeconds={displaySeconds}
                  isRunning={isRunning}
                  onToggleRun={() => setIsRunning((r) => !r)}
                  onResetTimer={handleResetTimer}
                  onChangeTimerConfig={handleChangeTimerConfig}
                  onCompleteTarget={() => void handleCompleteTarget()}
                  onPopoutOverlay={() => {
                    void timerOverlayRef.current?.openPopoutWindow();
                  }}
                  onGoToTaskManagement={() => navigateTo(0)}
                />
              )}

              {pageIndex === 2 && (
                <CalendarView onBackHome={() => navigateTo(1)} />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Persistent Pop-out / Floating Timer Overlay Widget */}
      <TimerOverlay
        ref={timerOverlayRef}
        visible={overlayVisible}
        onClose={() => {
          setForceOverlay(false);
          if (pageIndex !== 1) {
            setIsRunning(false);
          }
        }}
        board={resolved.board}
        project={resolved.project}
        task={resolved.task}
        subtask={resolved.subtask}
        mode={timerMode}
        pomodoroPreset={pomodoroPreset}
        pomodoroPhase={pomodoroPhase}
        customWorkMinutes={customWorkMinutes}
        customBreakMinutes={customBreakMinutes}
        displaySeconds={displaySeconds}
        isRunning={isRunning}
        onToggleRun={() => setIsRunning((r) => !r)}
        onReset={handleResetTimer}
        onChangeConfig={handleChangeTimerConfig}
        onCompleteTarget={() => void handleCompleteTarget()}
      />
    </div>
  );
}
