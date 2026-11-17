'use client';

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  ExternalLink,
  GripHorizontal,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Timer,
  X,
} from 'lucide-react';
import { formatTimerClock } from '@/lib/time';
import type {
  PomodoroPhase,
  PomodoroPreset,
  Project,
  Subtask,
  Task,
  TaskBoard,
  TimerMode,
} from '@/types/kanso';

interface DocumentPictureInPictureApi {
  requestWindow: (options?: {
    width?: number;
    height?: number;
  }) => Promise<Window>;
}

export interface TimerOverlayHandle {
  openPopoutWindow: () => Promise<void>;
  closePopoutWindow: () => void;
}

interface TimerOverlayProps {
  visible: boolean;
  onClose: () => void;
  board: TaskBoard | null;
  project: Project | null;
  task: Task | null;
  subtask: Subtask | null;
  mode: TimerMode;
  pomodoroPreset: PomodoroPreset;
  pomodoroPhase: PomodoroPhase;
  customWorkMinutes: number;
  customBreakMinutes: number;
  displaySeconds: number;
  isRunning: boolean;
  onToggleRun: () => void;
  onReset: () => void;
  onChangeConfig: (cfg: {
    mode?: TimerMode;
    preset?: PomodoroPreset;
    customWork?: number;
    customBreak?: number;
  }) => void;
  onCompleteTarget: () => void;
}

export const TimerOverlay = forwardRef<TimerOverlayHandle, TimerOverlayProps>(
  function TimerOverlay(
    {
      visible,
      onClose,
      board,
      project,
      task,
      subtask,
      mode,
      pomodoroPreset,
      pomodoroPhase,
      customWorkMinutes,
      customBreakMinutes,
      displaySeconds,
      isRunning,
      onToggleRun,
      onReset,
      onChangeConfig,
      onCompleteTarget,
    },
    ref
  ) {
    const [minimized, setMinimized] = useState(false);
    const [pipWindow, setPipWindow] = useState<Window | null>(null);
    const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);

    useEffect(() => {
      return () => {
        if (pipWindow && !pipWindow.closed) {
          pipWindow.close();
        }
      };
    }, [pipWindow]);

    async function openPopoutWindow() {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.focus();
        return;
      }

      const docPiP = (
        window as unknown as {
          documentPictureInPicture?: DocumentPictureInPictureApi;
        }
      ).documentPictureInPicture;

      let targetWin: Window | null = null;
      try {
        if (docPiP) {
          targetWin = await docPiP.requestWindow({ width: 370, height: 255 });
        } else {
          targetWin = window.open(
            '',
            'kanso_timer_pip',
            'width=370,height=255,menubar=no,toolbar=no,location=no,status=no'
          );
        }
      } catch {
        targetWin = window.open(
          '',
          'kanso_timer_pip',
          'width=370,height=255,menubar=no,toolbar=no,location=no,status=no'
        );
      }

      if (!targetWin) return;

      targetWin.document.title = 'kanso — focus timer';
      targetWin.document.body.innerHTML = '';
      targetWin.document.body.style.margin = '0';
      targetWin.document.body.style.backgroundColor = '#0A0A0C';
      targetWin.document.body.style.color = '#FFFFFF';
      targetWin.document.body.style.fontFamily =
        'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

      Array.from(document.styleSheets).forEach((sheet) => {
        try {
          if (sheet.href) {
            const link = targetWin!.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            targetWin!.document.head.appendChild(link);
          } else if (sheet.cssRules) {
            const style = targetWin!.document.createElement('style');
            style.textContent = Array.from(sheet.cssRules)
              .map((r) => r.cssText)
              .join('\n');
            targetWin!.document.head.appendChild(style);
          }
        } catch {
          // Ignore cross-origin stylesheet restrictions
        }
      });

      const root = targetWin.document.createElement('div');
      root.style.minHeight = '100vh';
      root.style.backgroundColor = '#0A0A0C';
      root.style.color = '#FFFFFF';
      targetWin.document.body.appendChild(root);

      targetWin.addEventListener('pagehide', () => {
        setPipWindow(null);
        setPipContainer(null);
      });
      targetWin.addEventListener('beforeunload', () => {
        setPipWindow(null);
        setPipContainer(null);
      });

      setPipWindow(targetWin);
      setPipContainer(root);
    }

    function closePopoutWindow() {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
      }
      setPipWindow(null);
      setPipContainer(null);
    }

    useImperativeHandle(ref, () => ({
      openPopoutWindow,
      closePopoutWindow,
    }));

    if (!visible && !pipContainer) return null;

    const targetTitle = subtask?.title || task?.title || 'Focus Session';
    const contextLine = [board?.name, project?.name, subtask ? task?.title : null]
      .filter(Boolean)
      .join(' / ');
    const accentColor = board?.color || '#FFFFFF';
    const isTargetCompleted = subtask
      ? subtask.completed
      : task
        ? task.completed
        : false;

    const pipContent = (
      <div className="min-h-screen bg-[#0A0A0C] text-white p-4 flex flex-col justify-between select-none">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: accentColor }}
              />
              <span className="text-[11px] text-zinc-400 truncate">
                {contextLine || 'kanso'}
              </span>
            </div>
            <span className="rounded-full border border-white/10 bg-[#16161B] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-300 shrink-0">
              {mode === 'pomodoro'
                ? pomodoroPhase === 'work'
                  ? 'Focus'
                  : 'Break'
                : 'Normal'}
            </span>
          </div>
          <p className="text-sm font-semibold text-white truncate">
            {targetTitle}
          </p>
        </div>

        <div className="my-2 text-center">
          <div className="text-5xl font-mono font-bold tracking-tight text-white tabular-nums">
            {formatTimerClock(displaySeconds)}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleRun}
              className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#0A0A0C] px-4 py-2 text-xs font-semibold hover:bg-zinc-200 transition"
            >
              {isRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-[#0A0A0C]" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-[#0A0A0C]" />
                  <span>Start</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onReset}
              className="rounded-full border border-white/10 bg-[#17171D] p-2 text-zinc-300 hover:text-white transition"
              title="Reset timer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onCompleteTarget}
            disabled={!task}
            title={isTargetCompleted ? 'Unmark as Done' : 'Mark as Done'}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-medium transition ${
              isTargetCompleted
                ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                : 'border-white/15 bg-[#17171D] hover:bg-emerald-500/20 hover:border-emerald-400/40 disabled:opacity-40 text-zinc-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isTargetCompleted ? 'Done' : 'Complete'}</span>
          </button>
        </div>
      </div>
    );

    return (
      <>
        {pipContainer && createPortal(pipContent, pipContainer)}

        {visible && (
          <motion.aside
            drag
            dragMomentum={false}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-6 right-6 z-50 w-[330px] sm:w-[360px] rounded-3xl border border-white/15 bg-[#121216]/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] cursor-grab active:cursor-grabbing bg-white/[0.02]">
              <div className="flex items-center gap-2 min-w-0">
                <GripHorizontal className="w-4 h-4 text-zinc-500 shrink-0" />
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="text-[11px] font-medium text-zinc-400 truncate">
                  {contextLine || 'Focus Widget'}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={pipContainer ? closePopoutWindow : openPopoutWindow}
                  title={
                    pipContainer
                      ? 'Close floating PiP window'
                      : 'Pop out as always-on-top overlay widget'
                  }
                  className={`rounded-lg p-1.5 transition ${
                    pipContainer
                      ? 'bg-white text-[#0A0A0C]'
                      : 'text-zinc-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMinimized((m) => !m)}
                  title={minimized ? 'Expand widget' : 'Minimize widget'}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closePopoutWindow();
                    onClose();
                  }}
                  title="Hide timer widget"
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {minimized ? (
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">
                    {targetTitle}
                  </p>
                  <p className="text-lg font-mono font-bold text-white tabular-nums">
                    {formatTimerClock(displaySeconds)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onToggleRun}
                  className="rounded-full bg-white text-[#0A0A0C] p-2.5 hover:bg-zinc-200 transition"
                >
                  {isRunning ? (
                    <Pause className="w-4 h-4 fill-[#0A0A0C]" />
                  ) : (
                    <Play className="w-4 h-4 fill-[#0A0A0C]" />
                  )}
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                      {subtask ? 'Active Subtask' : 'Active Task'}
                    </p>
                    <h3 className="text-sm font-bold text-white truncate mt-0.5">
                      {targetTitle}
                    </h3>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#1B1B22] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 shrink-0">
                    <Timer className="w-3 h-3 text-zinc-400" />
                    {mode === 'pomodoro'
                      ? pomodoroPhase === 'work'
                        ? 'Focus'
                        : 'Break'
                      : 'Normal'}
                  </span>
                </div>

                <div className="rounded-2xl border border-white/[0.06] bg-[#0A0A0C] py-4 text-center">
                  <div className="text-4xl font-mono font-bold tracking-tight text-white tabular-nums">
                    {formatTimerClock(displaySeconds)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(['25:5', '50:10', 'custom'] as PomodoroPreset[]).map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          onChangeConfig({ mode: 'pomodoro', preset })
                        }
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                          mode === 'pomodoro' && pomodoroPreset === preset
                            ? 'bg-white text-[#0A0A0C] border-white font-semibold'
                            : 'bg-[#18181E] text-zinc-400 border-white/10 hover:text-white'
                        }`}
                      >
                        {preset === 'custom' ? 'Custom' : preset}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => onChangeConfig({ mode: 'normal' })}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                      mode === 'normal'
                        ? 'bg-white text-[#0A0A0C] border-white font-semibold'
                        : 'bg-[#18181E] text-zinc-400 border-white/10 hover:text-white'
                    }`}
                  >
                    Normal
                  </button>
                </div>

                {mode === 'pomodoro' && pomodoroPreset === 'custom' && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#0A0A0C] px-3 py-2 text-xs">
                    <span className="text-zinc-400">Work / Break (min)</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={customWorkMinutes}
                        onChange={(e) =>
                          onChangeConfig({
                            customWork: Math.max(
                              1,
                              Math.min(180, Number(e.target.value) || 25)
                            ),
                          })
                        }
                        className="w-12 rounded-md border border-white/15 bg-[#16161B] px-1.5 py-0.5 text-center font-mono text-white focus:outline-none"
                      />
                      <span className="text-zinc-500">:</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={customBreakMinutes}
                        onChange={(e) =>
                          onChangeConfig({
                            customBreak: Math.max(
                              1,
                              Math.min(60, Number(e.target.value) || 5)
                            ),
                          })
                        }
                        className="w-12 rounded-md border border-white/15 bg-[#16161B] px-1.5 py-0.5 text-center font-mono text-white focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onToggleRun}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-4 py-2 text-xs font-semibold shadow-[0_0_20px_rgba(255,255,255,0.14)] transition"
                    >
                      {isRunning ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-[#0A0A0C]" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-[#0A0A0C]" />
                          <span>Start</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={onReset}
                      title="Reset timer"
                      className="rounded-full border border-white/10 bg-[#1A1A20] hover:bg-[#23232B] p-2 text-zinc-300 hover:text-white transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onCompleteTarget}
                    disabled={!task}
                    title={isTargetCompleted ? 'Unmark as Done' : 'Mark as Done'}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                      isTargetCompleted
                        ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                        : 'border-white/15 bg-[#1A1A20] hover:bg-emerald-500/20 hover:border-emerald-400/40 disabled:opacity-40 text-zinc-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isTargetCompleted ? 'Done' : 'Mark Done'}</span>
                  </button>
                </div>
              </div>
            )}
          </motion.aside>
        )}
      </>
    );
  }
);
