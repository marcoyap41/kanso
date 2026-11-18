'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Play,
  Plus,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  formatLoggedDuration,
  formatShortDateLabel,
  parseLocalDateKey,
  toLocalDateKey,
} from '@/lib/time';
import type {
  FocusSelection,
  FocusSession,
  Project,
  Task,
  TaskBoard,
  TimerMode,
} from '@/types/kanso';

interface CalendarViewProps {
  boards: TaskBoard[];
  focusSessions: FocusSession[];
  onRefresh: () => Promise<void>;
  onStartWork: (selection: FocusSelection) => void;
  onGoToTaskManagement: () => void;
  onBackHome: () => void;
}

type CalendarMode = 'week' | 'day' | 'month';

interface FlatTask {
  task: Task;
  project: Project;
  board: TaskBoard;
}

interface PositionedItem {
  id: string;
  startMin: number;
  endMin: number;
  lane: number;
  laneCount: number;
  kind: 'task' | 'session';
  flatTask?: FlatTask;
  session?: FocusSession;
}

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, idx) => idx);
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DURATION_PRESETS = [15, 25, 30, 45, 50, 60, 90, 120, 180, 240];

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = parseLocalDateKey(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return toLocalDateKey(d);
}

function shiftMonthKey(dateKey: string, deltaMonths: number): string {
  const d = parseLocalDateKey(dateKey);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + deltaMonths);
  const daysInTargetMonth = new Date(
    d.getFullYear(),
    d.getMonth() + 1,
    0
  ).getDate();
  d.setDate(Math.min(targetDay, daysInTargetMonth));
  return toLocalDateKey(d);
}

function getMondayWeekStartKey(dateKey: string): string {
  const d = parseLocalDateKey(dateKey);
  const jsDay = d.getDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diffToMonday);
  return toLocalDateKey(d);
}

function getWeekDateKeys(anchorKey: string): string[] {
  const startKey = getMondayWeekStartKey(anchorKey);
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(startKey, i));
}

function getMonthGridCells(
  anchorKey: string
): { dateKey: string; inMonth: boolean }[] {
  const anchor = parseLocalDateKey(anchorKey);
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startKey = getMondayWeekStartKey(toLocalDateKey(firstOfMonth));
  const targetMonth = anchor.getMonth();

  const cells: { dateKey: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const dateKey = shiftDateKey(startKey, i);
    const d = parseLocalDateKey(dateKey);
    cells.push({
      dateKey,
      inMonth: d.getMonth() === targetMonth,
    });
  }

  // Drop trailing 6th row if all 7 days belong to next month
  const lastRow = cells.slice(35);
  if (lastRow.every((c) => !c.inMonth)) {
    return cells.slice(0, 35);
  }
  return cells;
}

function parseTimeToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function formatClockTime(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatHourGutter(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatPeriodHeading(mode: CalendarMode, anchorKey: string): string {
  const d = parseLocalDateKey(anchorKey);
  if (mode === 'day') {
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (mode === 'month') {
    return d.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  const weekKeys = getWeekDateKeys(anchorKey);
  const start = parseLocalDateKey(weekKeys[0]);
  const end = parseLocalDateKey(weekKeys[6]);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', {
      month: 'short',
    })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} – ${end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} – ${end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

/**
 * Assign side-by-side column lanes for overlapping timeline items on a given day.
 */
function buildTimelineItemsForDay(
  slottedTasks: FlatTask[],
  sessions: FocusSession[]
): PositionedItem[] {
  const raw: Array<{
    id: string;
    startMin: number;
    endMin: number;
    kind: 'task' | 'session';
    flatTask?: FlatTask;
    session?: FocusSession;
  }> = [];

  for (const item of slottedTasks) {
    if (!item.task.scheduled_time) continue;
    const startMin = parseTimeToMinutes(item.task.scheduled_time);
    const dur = item.task.scheduled_duration_minutes || 60;
    const endMin = Math.min(1440, startMin + Math.max(15, dur));
    raw.push({
      id: `task-${item.task.id}`,
      startMin,
      endMin,
      kind: 'task',
      flatTask: item,
    });
  }

  for (const session of sessions) {
    const start = new Date(session.started_at);
    const startMin = Number.isNaN(start.getTime())
      ? 9 * 60
      : start.getHours() * 60 + start.getMinutes();
    const durMins = Math.max(10, Math.round(session.duration_seconds / 60));
    const endMin = Math.min(1440, Math.max(startMin + 15, startMin + durMins));
    raw.push({
      id: `sess-${session.id}`,
      startMin,
      endMin,
      kind: 'session',
      session,
    });
  }

  raw.sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1;
    return b.endMin - a.endMin;
  });

  // Group into connected overlap clusters
  const result: PositionedItem[] = [];
  let cluster: typeof raw = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const placed: Array<{ item: (typeof raw)[number]; lane: number }> = [];

    for (const entry of cluster) {
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= entry.startMin) {
          assigned = i;
          laneEnds[i] = entry.endMin;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(entry.endMin);
      }
      placed.push({ item: entry, lane: assigned });
    }

    const totalLanes = Math.max(1, laneEnds.length);
    for (const p of placed) {
      result.push({
        ...p.item,
        lane: p.lane,
        laneCount: totalLanes,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of raw) {
    if (cluster.length === 0 || entry.startMin < clusterEnd) {
      cluster.push(entry);
      clusterEnd = Math.max(clusterEnd, entry.endMin);
    } else {
      flushCluster();
      cluster.push(entry);
      clusterEnd = entry.endMin;
    }
  }
  flushCluster();

  return result;
}

export function CalendarView({
  boards,
  focusSessions,
  onRefresh,
  onStartWork,
  onGoToTaskManagement,
  onBackHome,
}: CalendarViewProps) {
  const todayKey = toLocalDateKey(new Date());
  const [viewMode, setViewMode] = useState<CalendarMode>('week');
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);
  const [anchorDateKey, setAnchorDateKey] = useState<string>(todayKey);
  const [showPlanned, setShowPlanned] = useState(true);
  const [showSessions, setShowSessions] = useState(true);
  const [nowMinutes, setNowMinutes] = useState<number>(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Schedule modal state
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'existing' | 'new'>(
    'existing'
  );
  const [modalTaskId, setModalTaskId] = useState<string>('');
  const [modalProjectId, setModalProjectId] = useState<string>('');
  const [modalNewTaskTitle, setModalNewTaskTitle] = useState('');
  const [modalDate, setModalDate] = useState(todayKey);
  const [modalTime, setModalTime] = useState('');
  const [modalDuration, setModalDuration] = useState(60);

  // Manual Focus Session modal state
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string>('');
  const [logSubtaskId, setLogSubtaskId] = useState<string>('');
  const [logDate, setLogDate] = useState(todayKey);
  const [logStartTime, setLogStartTime] = useState('09:00');
  const [logDurationMins, setLogDurationMins] = useState(25);
  const [logTimerMode, setLogTimerMode] = useState<TimerMode>('pomodoro');

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialScrollRef = useRef(false);

  // Keep live current-time line synced every minute
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Scroll timeline cleanly to 06:00 when entering Day/Week timeline
  useEffect(() => {
    if (viewMode === 'month') {
      didInitialScrollRef.current = false;
      return;
    }
    if (!didInitialScrollRef.current && timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = 6 * HOUR_HEIGHT;
      didInitialScrollRef.current = true;
    }
  }, [viewMode]);

  // Close open modals on Escape
  useEffect(() => {
    if (!scheduleModalOpen && !logModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setScheduleModalOpen(false);
        setLogModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scheduleModalOpen, logModalOpen]);

  const flatTasks = useMemo<FlatTask[]>(() => {
    const list: FlatTask[] = [];
    for (const board of boards) {
      for (const project of board.projects) {
        for (const task of project.tasks) {
          list.push({ task, project, board });
        }
      }
    }
    return list;
  }, [boards]);

  const allProjects = useMemo(() => {
    const list: Array<{ project: Project; board: TaskBoard }> = [];
    for (const board of boards) {
      for (const project of board.projects) {
        list.push({ project, board });
      }
    }
    return list;
  }, [boards]);

  const scheduledTasksByDate = useMemo(() => {
    const map = new Map<string, FlatTask[]>();
    for (const item of flatTasks) {
      const date = item.task.scheduled_date;
      if (!date) continue;
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(item);
    }
    return map;
  }, [flatTasks]);

  const unscheduledTasks = useMemo(
    () => flatTasks.filter((f) => !f.task.scheduled_date && !f.task.completed),
    [flatTasks]
  );

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, FocusSession[]>();
    for (const sess of focusSessions) {
      if (!map.has(sess.session_date)) map.set(sess.session_date, []);
      map.get(sess.session_date)!.push(sess);
    }
    return map;
  }, [focusSessions]);

  const visibleDateKeys = useMemo(() => {
    if (viewMode === 'day') return [anchorDateKey];
    if (viewMode === 'week') return getWeekDateKeys(anchorDateKey);
    return getMonthGridCells(anchorDateKey)
      .filter((c) => c.inMonth)
      .map((c) => c.dateKey);
  }, [viewMode, anchorDateKey]);

  const monthGridCells = useMemo(() => {
    if (viewMode !== 'month') return [];
    return getMonthGridCells(anchorDateKey);
  }, [viewMode, anchorDateKey]);

  // Period stats (visible window + today)
  const periodStats = useMemo(() => {
    const visibleSet = new Set(visibleDateKeys);
    let visibleFocusSeconds = 0;
    let todayFocusSeconds = 0;
    let scheduledTotal = 0;
    let scheduledCompleted = 0;

    for (const s of focusSessions) {
      if (visibleSet.has(s.session_date)) {
        visibleFocusSeconds += s.duration_seconds;
      }
      if (s.session_date === todayKey) {
        todayFocusSeconds += s.duration_seconds;
      }
    }

    for (const item of flatTasks) {
      if (item.task.scheduled_date && visibleSet.has(item.task.scheduled_date)) {
        scheduledTotal += 1;
        if (item.task.completed) scheduledCompleted += 1;
      }
    }

    return {
      visibleFocusSeconds,
      todayFocusSeconds,
      scheduledTotal,
      scheduledCompleted,
    };
  }, [visibleDateKeys, focusSessions, flatTasks, todayKey]);

  // Selected Day Inspector data
  const selectedDayTasks = useMemo(() => {
    const items = [...(scheduledTasksByDate.get(selectedDateKey) || [])];
    items.sort((a, b) => {
      const ta = a.task.scheduled_time || '99:99';
      const tb = b.task.scheduled_time || '99:99';
      if (ta !== tb) return ta.localeCompare(tb);
      return Number(a.task.completed) - Number(b.task.completed);
    });
    return items;
  }, [scheduledTasksByDate, selectedDateKey]);

  const selectedDaySessions = useMemo(() => {
    const list = [...(sessionsByDate.get(selectedDateKey) || [])];
    list.sort(
      (a, b) =>
        new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );
    return list;
  }, [sessionsByDate, selectedDateKey]);

  const selectedDayFocusSeconds = useMemo(
    () =>
      selectedDaySessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0),
    [selectedDaySessions]
  );

  const selectedDayBoardBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { name: string; color: string; seconds: number }
    >();
    for (const s of selectedDaySessions) {
      const key = s.board_name || 'Focus';
      const prev = map.get(key) || {
        name: key,
        color: s.board_color || '#FFFFFF',
        seconds: 0,
      };
      prev.seconds += s.duration_seconds || 0;
      map.set(key, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [selectedDaySessions]);

  const selectedLogTaskObj = useMemo(
    () => flatTasks.find((f) => String(f.task.id) === logTaskId) || null,
    [flatTasks, logTaskId]
  );

  const editingTaskObj = useMemo(
    () =>
      scheduleMode === 'existing'
        ? flatTasks.find((f) => String(f.task.id) === modalTaskId) || null
        : null,
    [flatTasks, modalTaskId, scheduleMode]
  );

  function stepPeriod(dir: -1 | 1) {
    if (viewMode === 'day') {
      const next = shiftDateKey(anchorDateKey, dir);
      setAnchorDateKey(next);
      setSelectedDateKey(next);
      return;
    }
    if (viewMode === 'week') {
      const nextAnchor = shiftDateKey(anchorDateKey, dir * 7);
      setAnchorDateKey(nextAnchor);
      setSelectedDateKey(shiftDateKey(selectedDateKey, dir * 7));
      return;
    }
    const nextMonth = shiftMonthKey(anchorDateKey, dir);
    setAnchorDateKey(nextMonth);
    setSelectedDateKey(nextMonth);
  }

  function jumpToToday() {
    setAnchorDateKey(todayKey);
    setSelectedDateKey(todayKey);
  }

  function handleSelectDay(dateKey: string, switchToDay = false) {
    setSelectedDateKey(dateKey);
    if (switchToDay) {
      setAnchorDateKey(dateKey);
      setViewMode('day');
    }
  }

  function openScheduleModal(opts?: {
    dateKey?: string;
    time?: string;
    task?: Task;
  }) {
    setError(null);
    const targetDate = opts?.dateKey || selectedDateKey || todayKey;
    setModalDate(targetDate);

    if (opts?.task) {
      setScheduleMode('existing');
      setModalTaskId(String(opts.task.id));
      setModalTime(opts.time ?? opts.task.scheduled_time ?? '');
      setModalDuration(opts.task.scheduled_duration_minutes || 60);
    } else {
      const preferred = unscheduledTasks[0] || flatTasks[0] || null;
      if (preferred) {
        setScheduleMode('existing');
        setModalTaskId(String(preferred.task.id));
      } else if (allProjects[0]) {
        setScheduleMode('new');
        setModalProjectId(String(allProjects[0].project.id));
        setModalTaskId('');
      }
      setModalTime(opts?.time ?? '');
      setModalDuration(60);
    }

    if (allProjects[0] && !modalProjectId) {
      setModalProjectId(String(allProjects[0].project.id));
    }
    setModalNewTaskTitle('');
    setScheduleModalOpen(true);
  }

  function openLogSessionModal(opts?: { dateKey?: string; taskId?: number }) {
    setError(null);
    setLogDate(opts?.dateKey || selectedDateKey || todayKey);
    const preferred =
      (opts?.taskId
        ? flatTasks.find((f) => f.task.id === opts.taskId)
        : null) ||
      flatTasks[0] ||
      null;
    setLogTaskId(preferred ? String(preferred.task.id) : '');
    setLogSubtaskId('');
    setLogStartTime('09:00');
    setLogDurationMins(25);
    setLogTimerMode('pomodoro');
    setLogModalOpen(true);
  }

  async function runAction(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calendar action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleTaskDone(task: Task) {
    await runAction(async () => {
      const nextCompleted = !task.completed;
      await api.updateTask(task.id, { completed: nextCompleted });
      const subs = task.subtasks.filter((s) => s.completed !== nextCompleted);
      if (subs.length > 0) {
        await Promise.all(
          subs.map((s) => api.updateSubtask(s.id, { completed: nextCompleted }))
        );
      }
    });
  }

  async function handleSaveScheduleModal(e: React.FormEvent) {
    e.preventDefault();
    if (!modalDate) return;

    await runAction(async () => {
      if (scheduleMode === 'new') {
        const pid = Number(modalProjectId);
        const title = modalNewTaskTitle.trim();
        if (!pid || !title) {
          throw new Error('Select a project and enter a task title.');
        }
        await api.createTask({
          project_id: pid,
          title,
          scheduled_date: modalDate,
          scheduled_time: modalTime || null,
          scheduled_duration_minutes: modalDuration,
        });
      } else {
        const tid = Number(modalTaskId);
        if (!tid) {
          throw new Error('Please choose a task to schedule.');
        }
        await api.updateTask(tid, {
          scheduled_date: modalDate,
          scheduled_time: modalTime || null,
          scheduled_duration_minutes: modalDuration,
        });
      }
      setSelectedDateKey(modalDate);
      setScheduleModalOpen(false);
    });
  }

  async function handleUnscheduleTask(taskId: number) {
    await runAction(async () => {
      await api.updateTask(taskId, {
        scheduled_date: null,
        scheduled_time: null,
      });
      setScheduleModalOpen(false);
    });
  }

  async function handleSaveLogSession(e: React.FormEvent) {
    e.preventDefault();
    const tid = Number(logTaskId);
    if (!tid) {
      setError('Please select a task for this focus session.');
      return;
    }

    await runAction(async () => {
      await api.createFocusSession({
        task_id: tid,
        subtask_id: logSubtaskId ? Number(logSubtaskId) : null,
        duration_minutes: Math.max(1, Math.min(720, Number(logDurationMins) || 25)),
        session_date: logDate,
        start_time: logStartTime || null,
        mode: logTimerMode,
        tz_offset_minutes: new Date().getTimezoneOffset(),
      });
      setSelectedDateKey(logDate);
      setLogModalOpen(false);
    });
  }

  async function handleDeleteSession(sessionId: number) {
    await runAction(async () => {
      await api.deleteFocusSession(sessionId);
    });
  }

  const timelineDays =
    viewMode === 'day' ? [anchorDateKey] : getWeekDateKeys(anchorDateKey);
  const maxBoardDaySeconds = Math.max(
    1,
    ...selectedDayBoardBreakdown.map((b) => b.seconds)
  );

  return (
    <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4 sm:px-8 pt-5 pb-20">
      {/* Top Header & Navigation */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <button
              type="button"
              onClick={onBackHome}
              title="Back to Home"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#141418] hover:border-white/25 hover:text-white px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Home</span>
            </button>
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Schedule &amp; Focus History
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-bold tracking-[-0.03em] text-white">
            {formatPeriodHeading(viewMode, anchorDateKey)}
          </h1>

          {/* Live Summary Pills + Layer Toggles */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#131318] px-3 py-1 text-xs font-mono text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Today: {formatLoggedDuration(periodStats.todayFocusSeconds)}
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#131318] px-3 py-1 text-xs font-mono text-zinc-300">
              <Timer className="w-3.5 h-3.5 text-zinc-400" />
              <span>
                {viewMode === 'day'
                  ? 'Day'
                  : viewMode === 'week'
                    ? 'Week'
                    : 'Month'}
                : {formatLoggedDuration(periodStats.visibleFocusSeconds)}
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#131318] px-3 py-1 text-xs font-mono text-zinc-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" />
              <span>
                {periodStats.scheduledCompleted}/{periodStats.scheduledTotal}{' '}
                scheduled
              </span>
            </span>

            <button
              type="button"
              onClick={() => setShowPlanned((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                showPlanned
                  ? 'border-white/25 bg-white/10 text-white'
                  : 'border-white/10 bg-[#111115] text-zinc-500'
              }`}
            >
              <span className="h-2 w-2 rounded-sm border border-current" />
              <span>Planned</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSessions((s) => !s)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                showSessions
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                  : 'border-white/10 bg-[#111115] text-zinc-500'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Focus Logs</span>
            </button>
          </div>
        </div>

        {/* Right Toolbar: Period Navigation, View Switcher, Primary Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Stepper */}
          <div className="inline-flex items-center rounded-full border border-white/10 bg-[#121216] p-1">
            <button
              type="button"
              onClick={() => stepPeriod(-1)}
              aria-label="Previous period"
              className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={jumpToToday}
              className="rounded-full px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-white/10 transition"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => stepPeriod(1)}
              aria-label="Next period"
              className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day / Week / Month Switcher */}
          <div className="inline-flex items-center rounded-full border border-white/10 bg-[#121216] p-1">
            {(['day', 'week', 'month'] as CalendarMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setViewMode(mode);
                  setAnchorDateKey(selectedDateKey);
                }}
                className={`rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition ${
                  viewMode === mode
                    ? 'bg-white text-[#0A0A0C]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Primary Actions */}
          <button
            type="button"
            onClick={() => openScheduleModal({ dateKey: selectedDateKey })}
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-4 py-2 text-xs font-semibold shadow-[0_0_24px_rgba(255,255,255,0.14)] transition"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            <span>Schedule Task</span>
          </button>

          <button
            type="button"
            onClick={() => openLogSessionModal({ dateKey: selectedDateKey })}
            disabled={flatTasks.length === 0}
            title={
              flatTasks.length === 0
                ? 'Create a task first to log focus sessions'
                : 'Manually log a completed focus session'
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#15151B] hover:border-white/30 hover:bg-[#1C1C24] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-white transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Session</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Split Grid: Calendar Surface + Selected Day Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Center Surface: Week / Day Timeline OR Month Grid */}
        <section className="lg:col-span-8 rounded-3xl border border-white/10 bg-[#111115]/90 backdrop-blur-xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          {viewMode === 'month' ? (
            <div className="p-4 sm:p-5">
              {/* Weekday Header */}
              <div className="grid grid-cols-7 gap-2 mb-2.5">
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className="text-center text-[11px] font-mono uppercase tracking-wider text-zinc-500 py-1"
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Month Grid Cells */}
              <div className="grid grid-cols-7 gap-2">
                {monthGridCells.map(({ dateKey, inMonth }) => {
                  const d = parseLocalDateKey(dateKey);
                  const isToday = dateKey === todayKey;
                  const isSelected = dateKey === selectedDateKey;
                  const dayTasks = showPlanned
                    ? scheduledTasksByDate.get(dateKey) || []
                    : [];
                  const daySessions = showSessions
                    ? sessionsByDate.get(dateKey) || []
                    : [];
                  const dayFocusSecs = daySessions.reduce(
                    (sum, s) => sum + (s.duration_seconds || 0),
                    0
                  );

                  return (
                    <div
                      key={dateKey}
                      onClick={() => handleSelectDay(dateKey, false)}
                      onDoubleClick={() => handleSelectDay(dateKey, true)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleSelectDay(dateKey, false);
                        }
                      }}
                      className={`group min-h-[102px] sm:min-h-[118px] rounded-2xl border p-2 text-left flex flex-col justify-between transition cursor-pointer ${
                        isSelected
                          ? 'border-white/40 bg-[#181820]'
                          : inMonth
                            ? 'border-white/[0.08] bg-[#0B0B0E] hover:border-white/25'
                            : 'border-white/[0.04] bg-[#09090B] opacity-50 hover:opacity-80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-mono ${
                            isToday
                              ? 'bg-white text-[#0A0A0C] font-bold'
                              : isSelected
                                ? 'bg-white/15 text-white font-semibold'
                                : 'text-zinc-300'
                          }`}
                        >
                          {d.getDate()}
                        </span>

                        <div className="flex items-center gap-1">
                          {dayFocusSecs > 0 && (
                            <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">
                              {formatLoggedDuration(dayFocusSecs)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openScheduleModal({ dateKey });
                            }}
                            title="Schedule task on this date"
                            className="opacity-0 group-hover:opacity-100 rounded-md p-0.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-1.5 space-y-1 overflow-hidden">
                        {dayTasks.slice(0, 3).map(({ task, board }) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] truncate bg-white/[0.04] border border-white/[0.06]"
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: board.color }}
                            />
                            <span
                              className={`truncate ${
                                task.completed
                                  ? 'line-through text-zinc-500'
                                  : 'text-zinc-200'
                              }`}
                            >
                              {task.scheduled_time
                                ? `${task.scheduled_time} `
                                : ''}
                              {task.title}
                            </span>
                          </div>
                        ))}
                        {dayTasks.length > 3 && (
                          <p className="text-[9px] font-mono text-zinc-500 px-1">
                            +{dayTasks.length - 3} more
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-zinc-500 text-right">
                Click a day to inspect · Double-click to open Day timeline
              </p>
            </div>
          ) : (
            /* Week & Day Timeline View */
            <div className="flex flex-col">
              {/* Column Headers + All-Day Unslotted Strip */}
              <div className="overflow-x-auto">
                <div
                  className={
                    viewMode === 'week' ? 'min-w-[680px]' : 'w-full'
                  }
                >
                  <div
                    className="grid border-b border-white/[0.08] bg-[#14141A]"
                    style={{
                      gridTemplateColumns: `56px repeat(${timelineDays.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="p-2 text-[10px] font-mono text-zinc-600 flex items-end justify-center pb-2.5 border-r border-white/[0.06]">
                      ALL
                    </div>
                    {timelineDays.map((dayKey) => {
                      const d = parseLocalDateKey(dayKey);
                      const isToday = dayKey === todayKey;
                      const isSelected = dayKey === selectedDateKey;
                      const dayTasks = scheduledTasksByDate.get(dayKey) || [];
                      const allDayTasks = showPlanned
                        ? dayTasks.filter((item) => !item.task.scheduled_time)
                        : [];
                      const dayFocusSecs = (
                        sessionsByDate.get(dayKey) || []
                      ).reduce((s, x) => s + (x.duration_seconds || 0), 0);

                      return (
                        <div
                          key={dayKey}
                          onClick={() => handleSelectDay(dayKey, false)}
                          className={`border-r last:border-r-0 border-white/[0.06] p-2.5 cursor-pointer transition ${
                            isSelected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                                {d.toLocaleDateString('en-US', {
                                  weekday: 'short',
                                })}
                              </span>
                              <span
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-mono ${
                                  isToday
                                    ? 'bg-white text-[#0A0A0C] font-bold'
                                    : isSelected
                                      ? 'bg-white/20 text-white font-semibold'
                                      : 'text-zinc-200'
                                }`}
                              >
                                {d.getDate()}
                              </span>
                            </div>

                            {dayFocusSecs > 0 && (
                              <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">
                                {formatLoggedDuration(dayFocusSecs)}
                              </span>
                            )}
                          </div>

                          {/* All-day / unslotted tasks */}
                          {allDayTasks.length > 0 && (
                            <div className="space-y-1 mt-1.5">
                              {allDayTasks.map(({ task, project, board }) => (
                                <div
                                  key={task.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openScheduleModal({
                                      dateKey: dayKey,
                                      task,
                                    });
                                  }}
                                  className="group/allday flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F] hover:border-white/30 px-2 py-1 text-[11px] transition"
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleToggleTaskDone(task);
                                    }}
                                    aria-label={`Toggle ${task.title}`}
                                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition ${
                                      task.completed
                                        ? 'border-emerald-400 bg-emerald-400 text-[#0A0A0C]'
                                        : 'border-white/30 hover:border-white'
                                    }`}
                                  >
                                    {task.completed && (
                                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                                    )}
                                  </button>
                                  <span
                                    className="h-1.5 w-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: board.color }}
                                  />
                                  <span
                                    className={`flex-1 truncate ${
                                      task.completed
                                        ? 'line-through text-zinc-500'
                                        : 'text-zinc-200'
                                    }`}
                                  >
                                    {task.title}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onStartWork({
                                        boardId: board.id,
                                        projectId: project.id,
                                        taskId: task.id,
                                        subtaskId: null,
                                      });
                                    }}
                                    title="Focus on this task"
                                    className="opacity-60 group-hover/allday:opacity-100 rounded p-0.5 text-zinc-300 hover:text-white"
                                  >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Scrollable 24-Hour Grid (starts scrolled to 06:00) */}
                  <div
                    ref={timelineScrollRef}
                    className="h-[580px] overflow-y-auto relative bg-[#0B0B0E]"
                  >
                    <div
                      className="grid relative"
                      style={{
                        gridTemplateColumns: `56px repeat(${timelineDays.length}, minmax(0, 1fr))`,
                        height: `${24 * HOUR_HEIGHT}px`,
                      }}
                    >
                      {/* Time Gutter */}
                      <div className="relative border-r border-white/[0.06] bg-[#0E0E12] select-none">
                        {HOURS.map((hour) => (
                          <div
                            key={hour}
                            style={{ height: `${HOUR_HEIGHT}px` }}
                            className="relative border-b border-white/[0.04]"
                          >
                            <span className="absolute -top-2 right-2 text-[10px] font-mono text-zinc-500">
                              {hour === 0 ? '' : formatHourGutter(hour)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Day Columns */}
                      {timelineDays.map((dayKey) => {
                        const isToday = dayKey === todayKey;
                        const isSelected = dayKey === selectedDateKey;
                        const slottedTasks = showPlanned
                          ? (scheduledTasksByDate.get(dayKey) || []).filter(
                              (item) => Boolean(item.task.scheduled_time)
                            )
                          : [];
                        const daySessions = showSessions
                          ? sessionsByDate.get(dayKey) || []
                          : [];
                        const positioned = buildTimelineItemsForDay(
                          slottedTasks,
                          daySessions
                        );

                        return (
                          <div
                            key={dayKey}
                            className={`relative border-r last:border-r-0 border-white/[0.06] ${
                              isSelected ? 'bg-white/[0.015]' : ''
                            }`}
                          >
                            {/* Hour Slots (click empty slot to schedule) */}
                            {HOURS.map((hour) => (
                              <div
                                key={hour}
                                style={{ height: `${HOUR_HEIGHT}px` }}
                                onClick={() => {
                                  setSelectedDateKey(dayKey);
                                  openScheduleModal({
                                    dateKey: dayKey,
                                    time: `${String(hour).padStart(2, '0')}:00`,
                                  });
                                }}
                                title={`Click to schedule at ${formatHourGutter(hour)}`}
                                className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-crosshair"
                              />
                            ))}

                            {/* Live Current Time Line */}
                            {isToday && (
                              <div
                                style={{
                                  top: `${(nowMinutes / 60) * HOUR_HEIGHT}px`,
                                }}
                                className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
                              >
                                <span className="-ml-1.5 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34D399]" />
                                <div className="h-[1.5px] flex-1 bg-emerald-400/90 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                              </div>
                            )}

                            {/* Scheduled Tasks & Focus Sessions */}
                            {positioned.map((entry) => {
                              const topPx = (entry.startMin / 60) * HOUR_HEIGHT;
                              const rawHeightPx =
                                ((entry.endMin - entry.startMin) / 60) *
                                HOUR_HEIGHT;
                              const heightPx = Math.max(26, rawHeightPx - 2);
                              const widthPct = 100 / entry.laneCount;
                              const leftPct = entry.lane * widthPct;

                              if (entry.kind === 'task' && entry.flatTask) {
                                const { task, project, board } = entry.flatTask;
                                return (
                                  <div
                                    key={entry.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedDateKey(dayKey);
                                      openScheduleModal({
                                        dateKey: dayKey,
                                        task,
                                      });
                                    }}
                                    style={{
                                      top: `${topPx + 1}px`,
                                      height: `${heightPx}px`,
                                      left: `calc(${leftPct}% + 3px)`,
                                      width: `calc(${widthPct}% - 6px)`,
                                      borderLeftColor: board.color,
                                    }}
                                    className={`group/blk absolute z-20 rounded-xl border border-white/15 border-l-[3px] px-2 py-1 overflow-hidden cursor-pointer backdrop-blur-md transition ${
                                      task.completed
                                        ? 'bg-[#121216]/75 opacity-65'
                                        : 'bg-[#16161E]/95 hover:border-white/35 shadow-[0_6px_20px_rgba(0,0,0,0.45)]'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-1">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleToggleTaskDone(task);
                                          }}
                                          aria-label={`Toggle ${task.title}`}
                                          className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition ${
                                            task.completed
                                              ? 'border-emerald-400 bg-emerald-400 text-[#0A0A0C]'
                                              : 'border-white/30 hover:border-white'
                                          }`}
                                        >
                                          {task.completed && (
                                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                                          )}
                                        </button>
                                        <span
                                          className={`text-[11px] font-semibold truncate ${
                                            task.completed
                                              ? 'line-through text-zinc-500'
                                              : 'text-white'
                                          }`}
                                        >
                                          {task.title}
                                        </span>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onStartWork({
                                            boardId: board.id,
                                            projectId: project.id,
                                            taskId: task.id,
                                            subtaskId: null,
                                          });
                                        }}
                                        title="Start focusing on this task"
                                        className="opacity-0 group-hover/blk:opacity-100 rounded-full bg-white text-[#0A0A0C] p-1 hover:bg-zinc-200 transition shrink-0"
                                      >
                                        <Play className="w-2.5 h-2.5 fill-current" />
                                      </button>
                                    </div>

                                    {heightPx >= 42 && (
                                      <p className="mt-0.5 pl-5 text-[10px] font-mono text-zinc-400 truncate">
                                        {task.scheduled_time} ·{' '}
                                        {task.scheduled_duration_minutes || 60}m
                                        {project.name
                                          ? ` · ${project.name}`
                                          : ''}
                                      </p>
                                    )}
                                  </div>
                                );
                              }

                              if (entry.kind === 'session' && entry.session) {
                                const sess = entry.session;
                                const accent = sess.board_color || '#34D399';
                                const label = sess.subtask_title
                                  ? `${sess.task_title} › ${sess.subtask_title}`
                                  : sess.task_title;

                                return (
                                  <div
                                    key={entry.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedDateKey(dayKey);
                                    }}
                                    style={{
                                      top: `${topPx + 1}px`,
                                      height: `${heightPx}px`,
                                      left: `calc(${leftPct}% + 3px)`,
                                      width: `calc(${widthPct}% - 6px)`,
                                      backgroundColor: `${accent}1E`,
                                      borderColor: `${accent}66`,
                                    }}
                                    title={`${label} (${formatLoggedDuration(sess.duration_seconds)})`}
                                    className="absolute z-10 rounded-xl border px-2 py-1 overflow-hidden cursor-pointer backdrop-blur-md transition hover:brightness-110"
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="flex items-center gap-1 min-w-0">
                                        <span
                                          className="h-1.5 w-1.5 rounded-full shrink-0"
                                          style={{ backgroundColor: accent }}
                                        />
                                        <span className="text-[11px] font-medium text-white truncate">
                                          {label}
                                        </span>
                                      </div>
                                      <span className="text-[9px] font-mono text-zinc-200 shrink-0">
                                        {formatLoggedDuration(
                                          sess.duration_seconds
                                        )}
                                      </span>
                                    </div>

                                    {heightPx >= 42 && (
                                      <p className="mt-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-300/80 truncate">
                                        {sess.mode} ·{' '}
                                        {formatClockTime(sess.started_at)}–
                                        {formatClockTime(sess.ended_at)}
                                      </p>
                                    )}
                                  </div>
                                );
                              }

                              return null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Sidebar: Selected Day Inspector + Unscheduled Backlog */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Panel 1: Selected Day Inspector */}
          <div className="rounded-3xl border border-white/10 bg-[#111115]/90 backdrop-blur-xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/[0.08]">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-500">
                  Selected Day
                </p>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  {formatShortDateLabel(selectedDateKey)} ·{' '}
                  {parseLocalDateKey(selectedDateKey).toLocaleDateString(
                    'en-US',
                    {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    }
                  )}
                </h2>
              </div>

              {viewMode !== 'day' && (
                <button
                  type="button"
                  onClick={() => handleSelectDay(selectedDateKey, true)}
                  className="rounded-full border border-white/15 bg-[#18181E] hover:bg-white hover:text-[#0A0A0C] px-3 py-1 text-[11px] font-medium text-zinc-300 transition shrink-0"
                >
                  Open Day
                </button>
              )}
            </div>

            {/* Focus Summary & Board Breakdown */}
            <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#0B0B0E] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] text-zinc-500">Total Focus Time</p>
                  <p className="text-2xl font-mono font-bold text-white mt-0.5">
                    {formatLoggedDuration(selectedDayFocusSeconds)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="rounded-full border border-white/10 bg-[#15151B] px-2.5 py-1 text-[10px] font-mono text-zinc-400">
                    {selectedDaySessions.length} session
                    {selectedDaySessions.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              {selectedDayBoardBreakdown.length > 0 && (
                <div className="mt-4 space-y-2.5 pt-3 border-t border-white/[0.06]">
                  {selectedDayBoardBreakdown.map((b) => {
                    const pct = Math.max(
                      6,
                      Math.round((b.seconds / maxBoardDaySeconds) * 100)
                    );
                    return (
                      <div key={b.name}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="flex items-center gap-1.5 text-zinc-300 truncate">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: b.color }}
                            />
                            <span className="truncate">{b.name}</span>
                          </span>
                          <span className="font-mono text-zinc-400 shrink-0">
                            {formatLoggedDuration(b.seconds)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: b.color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scheduled Tasks on Selected Date */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Scheduled Tasks ({selectedDayTasks.length})
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    openScheduleModal({ dateKey: selectedDateKey })
                  }
                  className="text-[11px] font-medium text-zinc-400 hover:text-white transition"
                >
                  + Add
                </button>
              </div>

              {selectedDayTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 py-4 px-3 text-center text-xs text-zinc-500">
                  No tasks scheduled for {formatShortDateLabel(selectedDateKey)}.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selectedDayTasks.map(({ task, project, board }) => (
                    <div
                      key={task.id}
                      className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#0B0B0E] hover:border-white/20 px-3 py-2 transition"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleTaskDone(task)}
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
                            openScheduleModal({
                              dateKey: selectedDateKey,
                              task,
                            })
                          }
                          className="min-w-0 text-left"
                        >
                          <p
                            className={`text-xs font-medium truncate ${
                              task.completed
                                ? 'line-through text-zinc-500'
                                : 'text-zinc-100'
                            }`}
                          >
                            {task.title}
                          </p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle"
                              style={{ backgroundColor: board.color }}
                            />
                            {project.name}
                            {task.scheduled_time
                              ? ` · ${task.scheduled_time} (${task.scheduled_duration_minutes || 60}m)`
                              : ' · All day'}
                          </p>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onStartWork({
                            boardId: board.id,
                            projectId: project.id,
                            taskId: task.id,
                            subtaskId: null,
                          })
                        }
                        title="Start focus timer"
                        className="rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 p-1.5 transition shrink-0"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Focus Session History Log on Selected Date */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Focus History ({selectedDaySessions.length})
                </h3>
                <button
                  type="button"
                  disabled={flatTasks.length === 0}
                  onClick={() =>
                    openLogSessionModal({ dateKey: selectedDateKey })
                  }
                  className="text-[11px] font-medium text-zinc-400 hover:text-white disabled:opacity-40 transition"
                >
                  + Log
                </button>
              </div>

              {selectedDaySessions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 py-4 px-3 text-center text-xs text-zinc-500">
                  No focus blocks recorded on{' '}
                  {formatShortDateLabel(selectedDateKey)}.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {selectedDaySessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="group flex items-start justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#0B0B0E] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: sess.board_color || '#FFFFFF',
                            }}
                          />
                          <p className="text-xs font-medium text-zinc-100 truncate">
                            {sess.subtask_title
                              ? `${sess.task_title} › ${sess.subtask_title}`
                              : sess.task_title}
                          </p>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                          <span>
                            {formatClockTime(sess.started_at)}–
                            {formatClockTime(sess.ended_at)}
                          </span>
                          <span>·</span>
                          <span className="text-emerald-300">
                            {formatLoggedDuration(sess.duration_seconds)}
                          </span>
                          <span className="rounded-full border border-white/10 px-1.5 py-0.2 uppercase text-[9px] text-zinc-400">
                            {sess.mode}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteSession(sess.id)}
                        title="Delete focus log entry"
                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300 transition shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Panel 2: Unscheduled Tasks Backlog */}
          <div className="rounded-3xl border border-white/10 bg-[#111115]/90 backdrop-blur-xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Unscheduled Backlog
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Assign open tasks directly onto {formatShortDateLabel(selectedDateKey)}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-[#18181E] px-2.5 py-0.5 text-[10px] font-mono text-zinc-400">
                {unscheduledTasks.length}
              </span>
            </div>

            {boards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-5 text-center">
                <Layers className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-400 mb-3">
                  Create a Task Board &amp; tasks in Task Management first.
                </p>
                <button
                  type="button"
                  onClick={onGoToTaskManagement}
                  className="rounded-full bg-white text-[#0A0A0C] px-4 py-1.5 text-xs font-semibold hover:bg-zinc-200 transition"
                >
                  Open Task Management
                </button>
              </div>
            ) : unscheduledTasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 py-5 px-3 text-center text-xs text-zinc-500">
                All active tasks are scheduled!
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {unscheduledTasks.slice(0, 20).map(({ task, project, board }) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#0B0B0E] hover:border-white/20 px-3 py-2 transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: board.color }}
                        />
                        <p className="text-xs font-medium text-zinc-200 truncate">
                          {task.title}
                        </p>
                      </div>
                      <p className="text-[10px] text-zinc-500 truncate pl-3.5">
                        {board.name} / {project.name}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        openScheduleModal({
                          dateKey: selectedDateKey,
                          task,
                        })
                      }
                      className="rounded-full border border-white/15 bg-[#16161C] hover:bg-white hover:text-[#0A0A0C] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition shrink-0"
                    >
                      Schedule
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Modal: Schedule Task (Existing or New) */}
      {scheduleModalOpen && (
        <div
          onClick={() => setScheduleModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#121217] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.85)]"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-zinc-300" />
                <h2 className="text-lg font-bold text-white">Schedule Task</h2>
              </div>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {allProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center">
                <p className="text-sm text-zinc-300 mb-2">
                  No projects available yet
                </p>
                <p className="text-xs text-zinc-500 mb-4">
                  Create a Task Board and a Project first so your scheduled
                  tasks stay organized.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setScheduleModalOpen(false);
                    onGoToTaskManagement();
                  }}
                  className="rounded-full bg-white text-[#0A0A0C] px-5 py-2 text-xs font-semibold hover:bg-zinc-200 transition"
                >
                  Go to Task Management
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveScheduleModal} className="space-y-4">
                {/* Mode Toggle: Existing Task vs Create New Task */}
                <div className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-[#0A0A0C] p-1">
                  <button
                    type="button"
                    disabled={flatTasks.length === 0}
                    onClick={() => setScheduleMode('existing')}
                    className={`rounded-full py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                      scheduleMode === 'existing'
                        ? 'bg-white text-[#0A0A0C]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Existing Task
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('new')}
                    className={`rounded-full py-1.5 text-xs font-semibold transition ${
                      scheduleMode === 'new'
                        ? 'bg-white text-[#0A0A0C]'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    + New Task
                  </button>
                </div>

                {scheduleMode === 'existing' ? (
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Task
                    </label>
                    <select
                      required
                      value={modalTaskId}
                      onChange={(e) => {
                        setModalTaskId(e.target.value);
                        const match = flatTasks.find(
                          (f) => String(f.task.id) === e.target.value
                        );
                        if (match?.task.scheduled_duration_minutes) {
                          setModalDuration(
                            match.task.scheduled_duration_minutes
                          );
                        }
                      }}
                      className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none"
                    >
                      <option value="">Select a task...</option>
                      {boards.map((board) =>
                        board.projects.map((proj) =>
                          proj.tasks.length > 0 ? (
                            <optgroup
                              key={proj.id}
                              label={`${board.name} / ${proj.name}`}
                            >
                              {proj.tasks.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.completed ? '[Done] ' : ''}
                                  {t.title}
                                  {t.scheduled_date
                                    ? ` (${t.scheduled_date})`
                                    : ''}
                                </option>
                              ))}
                            </optgroup>
                          ) : null
                        )
                      )}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Project
                      </label>
                      <select
                        required
                        value={modalProjectId}
                        onChange={(e) => setModalProjectId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none"
                      >
                        {allProjects.map(({ project, board }) => (
                          <option key={project.id} value={project.id}>
                            {board.name} / {project.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Task Title
                      </label>
                      <input
                        type="text"
                        required
                        value={modalNewTaskTitle}
                        onChange={(e) => setModalNewTaskTitle(e.target.value)}
                        placeholder="e.g. Draft architecture doc"
                        className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Date
                    </label>
                    <input
                      type="date"
                      required
                      value={modalDate}
                      onChange={(e) => setModalDate(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none [color-scheme:dark]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-zinc-400">
                        Start Time
                      </label>
                      {modalTime && (
                        <button
                          type="button"
                          onClick={() => setModalTime('')}
                          className="text-[10px] text-zinc-500 hover:text-white"
                        >
                          All day
                        </button>
                      )}
                    </div>
                    <input
                      type="time"
                      value={modalTime}
                      onChange={(e) => setModalTime(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none [color-scheme:dark]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Duration
                  </label>
                  <select
                    value={modalDuration}
                    onChange={(e) => setModalDuration(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  >
                    {!DURATION_PRESETS.includes(modalDuration) && (
                      <option value={modalDuration}>{modalDuration}m</option>
                    )}
                    <option value={15}>15 minutes</option>
                    <option value={25}>25 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={50}>50 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>1 hour 30 min</option>
                    <option value={120}>2 hours</option>
                    <option value={180}>3 hours</option>
                    <option value={240}>4 hours</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div className="flex items-center gap-2">
                    {editingTaskObj?.task.scheduled_date && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void handleUnscheduleTask(editingTaskObj.task.id)
                        }
                        className="rounded-full border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3.5 py-2 text-xs font-medium text-rose-300 transition"
                      >
                        Unschedule
                      </button>
                    )}
                    {editingTaskObj && (
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleModalOpen(false);
                          onStartWork({
                            boardId: editingTaskObj.board.id,
                            projectId: editingTaskObj.project.id,
                            taskId: editingTaskObj.task.id,
                            subtaskId: null,
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-[#18181F] hover:border-white/35 px-3 py-2 text-xs font-medium text-white transition"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Focus</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setScheduleModalOpen(false)}
                      className="rounded-full border border-white/10 px-4 py-2 text-xs text-zinc-400 hover:text-white transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-5 py-2 text-xs font-semibold transition"
                    >
                      Save Schedule
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Log Focus Session */}
      {logModalOpen && (
        <div
          onClick={() => setLogModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#121217] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.85)]"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">
                  Log Focus Session
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setLogModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveLogSession} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Task
                </label>
                <select
                  required
                  value={logTaskId}
                  onChange={(e) => {
                    setLogTaskId(e.target.value);
                    setLogSubtaskId('');
                  }}
                  className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2.5 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  <option value="">Select a task...</option>
                  {boards.map((board) =>
                    board.projects.map((proj) =>
                      proj.tasks.length > 0 ? (
                        <optgroup
                          key={proj.id}
                          label={`${board.name} / ${proj.name}`}
                        >
                          {proj.tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                        </optgroup>
                      ) : null
                    )
                  )}
                </select>
              </div>

              {selectedLogTaskObj &&
                selectedLogTaskObj.task.subtasks.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Subtask (optional)
                    </label>
                    <select
                      value={logSubtaskId}
                      onChange={(e) => setLogSubtaskId(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                    >
                      <option value="">None (log directly to task)</option>
                      {selectedLogTaskObj.task.subtasks.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none [color-scheme:dark]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={logStartTime}
                    onChange={(e) => setLogStartTime(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none [color-scheme:dark]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Duration (minutes)
                </label>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {[15, 25, 45, 50, 60, 90].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setLogDurationMins(m)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-mono border transition ${
                        logDurationMins === m
                          ? 'bg-white text-[#0A0A0C] border-white font-semibold'
                          : 'border-white/10 bg-[#0A0A0C] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1}
                  max={720}
                  required
                  value={logDurationMins}
                  onChange={(e) =>
                    setLogDurationMins(
                      Math.max(1, Math.min(720, Number(e.target.value) || 1))
                    )
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3.5 py-2 text-sm font-mono text-white focus:border-white/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Timer Mode
                </label>
                <div className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-[#0A0A0C] p-1">
                  {(['pomodoro', 'normal'] as TimerMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setLogTimerMode(m)}
                      className={`rounded-full py-1.5 text-xs font-semibold capitalize transition ${
                        logTimerMode === m
                          ? 'bg-white text-[#0A0A0C]'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLogModalOpen(false)}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs text-zinc-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-5 py-2 text-xs font-semibold transition"
                >
                  Log Focus Block
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
