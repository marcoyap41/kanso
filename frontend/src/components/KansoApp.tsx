'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  ChevronDown,
  Crosshair,
  Home,
  Layers,
  LogOut,
  Pencil,
  Timer,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatTimerClock, playZenChime, toLocalDateKey } from '@/lib/time';
import type {
  FocusSelection,
  FocusSession,
  PageIndex,
  PomodoroPhase,
  PomodoroPreset,
  TaskBoard,
  TimerMode,
  User,
} from '@/types/kanso';
import { AmbientBackdrop } from './AmbientBackdrop';
import { CalendarView } from './CalendarView';
import { HomeView } from './HomeView';
import {
  getCustomCursorEnabled,
  setCustomCursorEnabled,
} from './KansoCursor';
import { KansoLogo } from './KansoLogo';
import { NameOnboardingScreen } from './NameOnboardingScreen';
import { TaskManagementView } from './TaskManagementView';
import { TimerOverlay, type TimerOverlayHandle } from './TimerOverlay';

interface KansoAppProps {
  user: User;
  onUserUpdated: (user: User) => void;
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

export function KansoApp({ user, onUserUpdated, onLogout }: KansoAppProps) {
  // Spatial navigation: 0 (Task Management) <- 1 (Home) -> 2 (Calendar)
  const [[pageIndex, direction], setPageTuple] = useState<[PageIndex, number]>([
    1, 0,
  ]);

  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [loadingHierarchy, setLoadingHierarchy] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [editingNameOpen, setEditingNameOpen] = useState(false);
  const [customCursorOn, setCustomCursorOn] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCustomCursorOn(getCustomCursorEnabled());
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [userMenuOpen]);
  const [selection, setSelection] = useState<FocusSelection>({
    boardId: null,
    projectId: null,
    taskId: null,
    subtaskId: null,
  });

  // Main page working mode + optional floating overlay state
  const [isWorkingMode, setIsWorkingMode] = useState(false);
  const [forceOverlay, setForceOverlay] = useState(false);
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  // Persistent timer state across views
  const [timerMode, setTimerMode] = useState<TimerMode>('pomodoro');
  const [pomodoroPreset, setPomodoroPreset] = useState<PomodoroPreset>('25:5');
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>('work');
  const [customWorkMinutes, setCustomWorkMinutes] = useState(25);
  const [customBreakMinutes, setCustomBreakMinutes] = useState(5);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionWorkedSeconds, setSessionWorkedSeconds] = useState(0);

  const timerOverlayRef = useRef<TimerOverlayHandle | null>(null);
  const unsyncedSecondsRef = useRef(0);
  const sessionStartedAtRef = useRef<string | null>(null);
  const timerModeRef = useRef<TimerMode>(timerMode);
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
      const [data, sessionsData] = await Promise.all([
        api.getHierarchy(),
        api.getFocusSessions(),
      ]);
      setBoards(data.boards);
      setFocusSessions(sessionsData.sessions);

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

  useEffect(() => {
    timerModeRef.current = timerMode;
  }, [timerMode]);

  useEffect(() => {
    if (isRunning) {
      setOverlayDismissed(false);
      if (!sessionStartedAtRef.current) {
        sessionStartedAtRef.current = new Date().toISOString();
      }
    }
  }, [isRunning]);

  const flushWorkedSeconds = useCallback(async () => {
    const delta = unsyncedSecondsRef.current;
    const startedAt = sessionStartedAtRef.current;
    unsyncedSecondsRef.current = 0;
    sessionStartedAtRef.current = null;
    setSessionWorkedSeconds(0);

    if (delta <= 0) return;

    const { taskId, subtaskId } = activeTargetRef.current;
    if (!taskId && !subtaskId) {
      return;
    }

    const sessionDate = toLocalDateKey(new Date());
    const mode = timerModeRef.current;
    try {
      if (subtaskId) {
        await api.updateSubtask(subtaskId, {
          add_seconds: delta,
          mode,
          session_date: sessionDate,
          started_at: startedAt,
        });
      } else if (taskId) {
        await api.updateTask(taskId, {
          add_seconds: delta,
          mode,
          session_date: sessionDate,
          started_at: startedAt,
        });
      }
      await refreshHierarchy();
    } catch {
      unsyncedSecondsRef.current += delta;
      setSessionWorkedSeconds((prev) => prev + delta);
      if (!sessionStartedAtRef.current && startedAt) {
        sessionStartedAtRef.current = startedAt;
      }
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

  // 1-second timer tick loop (accumulates session seconds until session ends)
  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      if (timerMode === 'normal') {
        setElapsedSeconds((prev) => prev + 1);
        unsyncedSecondsRef.current += 1;
        setSessionWorkedSeconds((prev) => prev + 1);
      } else {
        if (pomodoroPhase === 'work') {
          unsyncedSecondsRef.current += 1;
          setSessionWorkedSeconds((prev) => prev + 1);
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

  const resetTimerClock = useCallback(
    (
      nextPreset: PomodoroPreset = pomodoroPreset,
      nextWork: number = customWorkMinutes,
      nextBreak: number = customBreakMinutes
    ) => {
      setIsRunning(false);
      setElapsedSeconds(0);
      setPomodoroPhase('work');
      const { workSeconds } = getPomodoroDurations(
        nextPreset,
        nextWork,
        nextBreak
      );
      setRemainingSeconds(workSeconds);
    },
    [pomodoroPreset, customWorkMinutes, customBreakMinutes]
  );

  const handleEndSession = useCallback(async () => {
    resetTimerClock();
    await flushWorkedSeconds();
  }, [flushWorkedSeconds, resetTimerClock]);

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

      setIsRunning(false);
      void flushWorkedSeconds();

      setTimerMode(nextMode);
      setPomodoroPreset(nextPreset);
      setCustomWorkMinutes(nextWork);
      setCustomBreakMinutes(nextBreak);

      setElapsedSeconds(0);
      setPomodoroPhase('work');
      const { workSeconds } = getPomodoroDurations(
        nextPreset,
        nextWork,
        nextBreak
      );
      setRemainingSeconds(workSeconds);
    },
    [
      flushWorkedSeconds,
      timerMode,
      pomodoroPreset,
      customWorkMinutes,
      customBreakMinutes,
    ]
  );

  const handleResetTimer = useCallback(() => {
    void handleEndSession();
  }, [handleEndSession]);

  const handleChooseFocusForWork = useCallback(
    async (nextSelection: FocusSelection, autoStart = false) => {
      setIsRunning(false);
      await flushWorkedSeconds();
      setSelection(nextSelection);
      activeTargetRef.current = {
        taskId: nextSelection.taskId,
        subtaskId: nextSelection.subtaskId,
      };
      resetTimerClock();
      setOverlayDismissed(false);
      setIsWorkingMode(true);
      navigateTo(1);
      if (autoStart) {
        setIsRunning(true);
      }
    },
    [flushWorkedSeconds, resetTimerClock, navigateTo]
  );

  const handleExitWorkingMode = useCallback(() => {
    resetTimerClock();
    setForceOverlay(false);
    void flushWorkedSeconds();
    setIsWorkingMode(false);
  }, [flushWorkedSeconds, resetTimerClock]);

  const handleCompleteTarget = useCallback(async () => {
    if (resolved.subtask) {
      const nextCompleted = !resolved.subtask.completed;
      if (nextCompleted) {
        resetTimerClock();
        await flushWorkedSeconds();
      }
      await api.updateSubtask(resolved.subtask.id, {
        completed: nextCompleted,
      });
    } else if (resolved.task) {
      const nextCompleted = !resolved.task.completed;
      if (nextCompleted) {
        resetTimerClock();
        await flushWorkedSeconds();
      }
      await api.updateTask(resolved.task.id, { completed: nextCompleted });
      const subsToUpdate = resolved.task.subtasks.filter(
        (s) => s.completed !== nextCompleted
      );
      if (subsToUpdate.length > 0) {
        await Promise.all(
          subsToUpdate.map((s) =>
            api.updateSubtask(s.id, { completed: nextCompleted })
          )
        );
      }
    }
    await refreshHierarchy();
  }, [
    flushWorkedSeconds,
    resetTimerClock,
    resolved.subtask,
    resolved.task,
    refreshHierarchy,
  ]);

  const displaySeconds =
    timerMode === 'pomodoro' ? remainingSeconds : elapsedSeconds;

  const overlayVisible =
    isWorkingMode && (forceOverlay || (pageIndex !== 1 && !overlayDismissed));

  return (
    <div className="relative min-h-screen bg-[#070709] text-white flex flex-col overflow-x-hidden">
      <AmbientBackdrop
        boards={boards}
        pageIndex={pageIndex}
        isWorkingMode={isWorkingMode}
        isRunning={isRunning}
        activeColor={resolved.board?.color ?? null}
      />

      {/* Top HUD Bar */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-5 sm:px-10 py-4 border-b border-white/[0.08] bg-[#070709]/85 backdrop-blur-md">
        <KansoLogo onClick={() => navigateTo(1)} />

        {/* Center Spatial Switcher: Task Management <- Home -> Calendar (Icon-only HUD tabs) */}
        <nav
          aria-label="Primary sections"
          className="order-3 sm:order-2 mx-auto sm:mx-0 sm:absolute sm:left-1/2 sm:-translate-x-1/2 flex items-center justify-center gap-1 rounded-full border border-white/15 bg-white/[0.04] p-1"
        >
          <button
            type="button"
            onClick={() => navigateTo(0)}
            title="Task Management"
            aria-label="Task Management"
            className={`inline-flex h-8 w-11 items-center justify-center rounded-full transition ${
              pageIndex === 0
                ? 'bg-white text-[#070709] shadow-[0_0_16px_rgba(255,255,255,0.28)]'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => navigateTo(1)}
            title="Home"
            aria-label="Home"
            className={`inline-flex h-8 w-11 items-center justify-center rounded-full transition ${
              pageIndex === 1
                ? 'bg-white text-[#070709] shadow-[0_0_16px_rgba(255,255,255,0.28)]'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Home className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => navigateTo(2)}
            title="Calendar"
            aria-label="Calendar"
            className={`inline-flex h-8 w-11 items-center justify-center rounded-full transition ${
              pageIndex === 2
                ? 'bg-white text-[#070709] shadow-[0_0_16px_rgba(255,255,255,0.28)]'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Calendar className="w-4 h-4" />
          </button>
        </nav>

        {/* Right Controls: Live Timer HUD + User Menu */}
        <div className="order-2 sm:order-3 flex items-center gap-2.5">
          {isWorkingMode && (
            <button
              type="button"
              onClick={() => {
                if (overlayVisible) {
                  setForceOverlay(false);
                  setOverlayDismissed(true);
                } else {
                  setForceOverlay(true);
                  setOverlayDismissed(false);
                }
              }}
              title="Toggle floating timer widget"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.05] hover:border-white/40 px-3.5 py-1.5 text-xs font-mono text-white transition"
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

          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.04] hover:border-white/40 px-3.5 py-1.5 text-xs font-medium text-zinc-200 transition"
            >
              <span>{user.name || user.username || user.email}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                  userMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/15 bg-[#0D0E12]/95 backdrop-blur-xl p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.85)] z-50 space-y-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setEditingNameOpen(true);
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.08] hover:text-white transition"
                  >
                    <span>Change name</span>
                    <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const next = !customCursorOn;
                      setCustomCursorOn(next);
                      setCustomCursorEnabled(next);
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.08] hover:text-white transition"
                  >
                    <span>Custom cursor</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono ${
                          customCursorOn
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                            : 'bg-white/[0.06] text-zinc-400 border border-white/10'
                        }`}
                      >
                        {customCursorOn ? 'On' : 'Off'}
                      </span>
                      <Crosshair className="w-3.5 h-3.5 text-zinc-400" />
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void handleEndSession().finally(() => {
                        onLogout();
                      });
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500 hover:text-white px-3 py-2 text-xs font-semibold text-rose-300 transition"
                  >
                    <span>Sign out</span>
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Smooth Horizontal Page Transition Container */}
      <main className="relative z-10 flex-1 overflow-x-hidden">
        {loadingHierarchy ? (
          <div className="flex min-h-[calc(100vh-120px)] items-center justify-center">
            <div className="flex items-center gap-3 text-xs font-mono tracking-wide text-zinc-500">
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
                  hasActiveSession={isRunning || sessionWorkedSeconds > 0}
                  onToggleRun={() => setIsRunning((r) => !r)}
                  onEndSession={() => void handleEndSession()}
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
                <CalendarView
                  boards={boards}
                  focusSessions={focusSessions}
                  onRefresh={refreshHierarchy}
                  onStartWork={(sel) => void handleChooseFocusForWork(sel, true)}
                  onGoToTaskManagement={() => navigateTo(0)}
                  onBackHome={() => navigateTo(1)}
                />
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
          setOverlayDismissed(true);
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
        hasActiveSession={isRunning || sessionWorkedSeconds > 0}
        onToggleRun={() => setIsRunning((r) => !r)}
        onEndSession={() => void handleEndSession()}
        onReset={handleResetTimer}
        onChangeConfig={handleChangeTimerConfig}
        onCompleteTarget={() => void handleCompleteTarget()}
      />

      {editingNameOpen && (
        <NameOnboardingScreen
          initialName={user.name || ''}
          onCompleted={(updated) => {
            onUserUpdated(updated);
            setEditingNameOpen(false);
          }}
          onCancel={() => setEditingNameOpen(false)}
        />
      )}
    </div>
  );
}
