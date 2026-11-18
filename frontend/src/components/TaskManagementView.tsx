'use client';

import React, { useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Layers,
  Palette,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  formatLoggedDuration,
  formatShortDateLabel,
  toLocalDateKey,
} from '@/lib/time';
import {
  BOARD_COLOR_PALETTE,
  MAX_TASK_BOARDS,
  type FocusSelection,
  type Task,
  type TaskBoard,
} from '@/types/kanso';

interface TaskManagementViewProps {
  boards: TaskBoard[];
  onRefresh: () => Promise<void>;
  onStartWork: (selection: FocusSelection) => void;
}

export function TaskManagementView({
  boards,
  onRefresh,
  onStartWork,
}: TaskManagementViewProps) {
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(
    boards[0]?.id ?? null
  );
  const [expandedTasks, setExpandedTasks] = useState<Record<number, boolean>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Board creation state
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardColor, setNewBoardColor] = useState<string>(
    BOARD_COLOR_PALETTE[1].hex
  );

  // Board edit state
  const [editingBoardId, setEditingBoardId] = useState<number | null>(null);
  const [editBoardName, setEditBoardName] = useState('');
  const [editBoardColor, setEditBoardColor] = useState<string>('#FFFFFF');

  // Inline creation drafts
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  const [taskDrafts, setTaskDrafts] = useState<Record<number, string>>({});
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<number, string>>(
    {}
  );

  // Task inline schedule editor state
  const [schedulingTaskId, setSchedulingTaskId] = useState<number | null>(null);
  const [scheduleDateDraft, setScheduleDateDraft] = useState('');
  const [scheduleTimeDraft, setScheduleTimeDraft] = useState('');
  const [scheduleDurationDraft, setScheduleDurationDraft] = useState(60);

  const activeBoard =
    boards.find((b) => b.id === selectedBoardId) || boards[0] || null;

  const canCreateBoard = boards.length < MAX_TASK_BOARDS;

  async function runAction(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBoard(e: React.FormEvent) {
    e.preventDefault();
    if (!newBoardName.trim() || !canCreateBoard) return;
    await runAction(async () => {
      const created = await api.createBoard({
        name: newBoardName.trim(),
        color: newBoardColor,
      });
      setSelectedBoardId(created.id);
      setNewBoardName('');
      setCreatingBoard(false);
    });
  }

  async function handleSaveBoardEdit(e: React.FormEvent, boardId: number) {
    e.preventDefault();
    if (!editBoardName.trim()) return;
    await runAction(async () => {
      await api.updateBoard(boardId, {
        name: editBoardName.trim(),
        color: editBoardColor,
      });
      setEditingBoardId(null);
    });
  }

  async function handleDeleteBoard(boardId: number) {
    await runAction(async () => {
      await api.deleteBoard(boardId);
      if (selectedBoardId === boardId) {
        setSelectedBoardId(null);
      }
    });
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBoard || !newProjectName.trim()) return;
    await runAction(async () => {
      await api.createProject({
        board_id: activeBoard.id,
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
      });
      setNewProjectName('');
      setNewProjectDesc('');
      setAddingProject(false);
    });
  }

  async function handleDeleteProject(projectId: number) {
    await runAction(async () => {
      await api.deleteProject(projectId);
    });
  }

  async function handleCreateTask(e: React.FormEvent, projectId: number) {
    e.preventDefault();
    const title = (taskDrafts[projectId] || '').trim();
    if (!title) return;
    await runAction(async () => {
      const created = await api.createTask({ project_id: projectId, title });
      setTaskDrafts((prev) => ({ ...prev, [projectId]: '' }));
      setExpandedTasks((prev) => ({ ...prev, [created.id]: true }));
    });
  }

  async function handleToggleTask(task: Task) {
    await runAction(async () => {
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
    });
  }

  async function handleDeleteTask(taskId: number) {
    await runAction(async () => {
      await api.deleteTask(taskId);
    });
  }

  async function handleCreateSubtask(e: React.FormEvent, taskId: number) {
    e.preventDefault();
    const title = (subtaskDrafts[taskId] || '').trim();
    if (!title) return;
    await runAction(async () => {
      await api.createSubtask({ task_id: taskId, title });
      setSubtaskDrafts((prev) => ({ ...prev, [taskId]: '' }));
      setExpandedTasks((prev) => ({ ...prev, [taskId]: true }));
    });
  }

  async function handleToggleSubtask(subtaskId: number, completed: boolean) {
    await runAction(async () => {
      await api.updateSubtask(subtaskId, { completed: !completed });
    });
  }

  async function handleDeleteSubtask(subtaskId: number) {
    await runAction(async () => {
      await api.deleteSubtask(subtaskId);
    });
  }

  function openScheduleEditor(task: Task) {
    if (schedulingTaskId === task.id) {
      setSchedulingTaskId(null);
      return;
    }
    setSchedulingTaskId(task.id);
    setScheduleDateDraft(task.scheduled_date || toLocalDateKey(new Date()));
    setScheduleTimeDraft(task.scheduled_time || '');
    setScheduleDurationDraft(task.scheduled_duration_minutes || 60);
  }

  async function handleSaveSchedule(e: React.FormEvent, taskId: number) {
    e.preventDefault();
    await runAction(async () => {
      await api.updateTask(taskId, {
        scheduled_date: scheduleDateDraft || null,
        scheduled_time: scheduleTimeDraft || null,
        scheduled_duration_minutes: scheduleDurationDraft,
      });
      setSchedulingTaskId(null);
    });
  }

  async function handleClearSchedule(taskId: number) {
    await runAction(async () => {
      await api.updateTask(taskId, {
        scheduled_date: null,
        scheduled_time: null,
      });
      setSchedulingTaskId(null);
    });
  }

  return (
    <div className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 pt-6 pb-24">
      {/* Page Title & Hierarchy Legend */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 mb-2">
            Big Picture → Micro-Steps
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-white">
            Task Management
          </h1>
          <p className="text-sm text-zinc-400 mt-2">
            Task Board (max 5) → Project → Task → Subtask (optional)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="rounded-full border border-white/10 bg-[#141418] px-3.5 py-1.5 text-xs font-mono text-zinc-300">
            {boards.length} / {MAX_TASK_BOARDS} Boards
          </span>
          <button
            type="button"
            disabled={!canCreateBoard}
            onClick={() => setCreatingBoard((prev) => !prev)}
            title={
              canCreateBoard
                ? 'Create a new Task Board'
                : 'Maximum of 5 Task Boards reached'
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold shadow-[0_0_24px_rgba(255,255,255,0.12)] transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Board</span>
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

      {/* New Task Board Drawer */}
      {creatingBoard && (
        <form
          onSubmit={handleCreateBoard}
          className="mb-6 rounded-3xl border border-white/15 bg-[#131318] p-5 shadow-2xl"
        >
          <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Task Board Name
              </label>
              <input
                type="text"
                required
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="e.g. College, Startup, Health, Personal"
                className="w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Assign Color
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0A0A0C] px-3 py-2">
                {BOARD_COLOR_PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setNewBoardColor(c.hex)}
                    title={c.label}
                    className={`h-5 w-5 rounded-full transition-transform ${
                      newBoardColor === c.hex
                        ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-[#0A0A0C]'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-5 py-2.5 text-xs font-semibold transition"
              >
                Create Board
              </button>
              <button
                type="button"
                onClick={() => setCreatingBoard(false)}
                className="rounded-full border border-white/10 bg-[#1A1A20] px-4 py-2.5 text-xs text-zinc-300 hover:text-white transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Task Boards Strip (up to 5) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {boards.map((board) => {
          const isSelected = activeBoard?.id === board.id;
          const isEditing = editingBoardId === board.id;
          const totalTasks = board.projects.reduce(
            (sum, p) => sum + p.tasks.length,
            0
          );

          if (isEditing) {
            return (
              <form
                key={board.id}
                onSubmit={(e) => handleSaveBoardEdit(e, board.id)}
                className="rounded-2xl border border-white/25 bg-[#15151B] p-3.5 space-y-2.5"
              >
                <input
                  type="text"
                  required
                  value={editBoardName}
                  onChange={(e) => setEditBoardName(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-[#0A0A0C] px-2.5 py-1.5 text-xs text-white focus:outline-none"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  {BOARD_COLOR_PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setEditBoardColor(c.hex)}
                      className={`h-4 w-4 rounded-full ${
                        editBoardColor === c.hex
                          ? 'ring-2 ring-white ring-offset-1 ring-offset-[#15151B]'
                          : 'opacity-70'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="submit"
                    className="rounded-full bg-white text-[#0A0A0C] px-3 py-1 text-[11px] font-semibold"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingBoardId(null)}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={board.id}
              onClick={() => setSelectedBoardId(board.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setSelectedBoardId(board.id);
                }
              }}
              className={`group relative cursor-pointer rounded-2xl border p-4 transition-all ${
                isSelected
                  ? 'border-white/30 bg-[#17171D] shadow-[0_12px_36px_rgba(0,0,0,0.45)]'
                  : 'border-white/[0.08] bg-[#111115] hover:border-white/20 hover:bg-[#141419]'
              }`}
            >
              {/* Top color bar */}
              <div
                className="h-1 w-10 rounded-full mb-3 transition-all group-hover:w-14"
                style={{ backgroundColor: board.color }}
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white truncate">
                    {board.name}
                  </h2>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {board.projects.length} project
                    {board.projects.length === 1 ? '' : 's'} · {totalTasks} task
                    {totalTasks === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {/* Edit / Delete Board actions on hover */}
              <div
                className="mt-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditingBoardId(board.id);
                    setEditBoardName(board.name);
                    setEditBoardColor(board.color);
                  }}
                  title="Edit board name or color"
                  className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white transition"
                >
                  <Palette className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteBoard(board.id)}
                  title="Delete board"
                  className="rounded-lg p-1 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {boards.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-zinc-400">
            Click <strong className="text-white">New Board</strong> above to
            create your first Task Board (up to 5).
          </div>
        )}
      </div>

      {/* Selected Board Workspace: Projects -> Tasks -> Subtasks */}
      {activeBoard && (
        <section className="rounded-3xl border border-white/10 bg-[#111115]/90 backdrop-blur-xl p-5 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 mb-6 border-b border-white/[0.08]">
            <div className="flex items-center gap-3">
              <span
                className="h-3.5 w-3.5 rounded-full shrink-0"
                style={{ backgroundColor: activeBoard.color }}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    {activeBoard.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBoardId(activeBoard.id);
                      setEditBoardName(activeBoard.name);
                      setEditBoardColor(activeBoard.color);
                    }}
                    className="rounded-lg p-1 text-zinc-500 hover:text-white hover:bg-white/10 transition"
                    title="Edit Board"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-zinc-500">
                  Projects, Tasks, and optional Micro-Subtasks inside{' '}
                  {activeBoard.name}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAddingProject((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#19191F] hover:bg-[#22222A] px-4 py-2 text-xs font-semibold text-white transition self-start sm:self-auto"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Add Project</span>
            </button>
          </div>

          {/* Add Project Form */}
          {addingProject && (
            <form
              onSubmit={handleCreateProject}
              className="mb-6 rounded-2xl border border-white/15 bg-[#0A0A0C] p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
            >
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Metopen"
                  className="w-full rounded-xl border border-white/10 bg-[#141418] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Short Note (optional)
                </label>
                <input
                  type="text"
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="e.g. Research methodology deliverables"
                  className="w-full rounded-xl border border-white/10 bg-[#141418] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-4 py-2 text-xs font-semibold transition"
                >
                  Save Project
                </button>
                <button
                  type="button"
                  onClick={() => setAddingProject(false)}
                  className="rounded-full border border-white/10 px-3.5 py-2 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Projects Grid */}
          {activeBoard.projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center">
              <Layers className="w-7 h-7 text-zinc-600 mx-auto mb-2.5" />
              <p className="text-sm text-zinc-400">
                No projects inside <strong>{activeBoard.name}</strong> yet.
              </p>
              <button
                type="button"
                onClick={() => setAddingProject(true)}
                className="mt-4 rounded-full bg-white text-[#0A0A0C] px-4 py-2 text-xs font-semibold hover:bg-zinc-200 transition"
              >
                + Create First Project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {activeBoard.projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-2xl border border-white/[0.08] bg-[#0B0B0E] p-5 flex flex-col justify-between"
                >
                  <div>
                    {/* Project Header */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: activeBoard.color }}
                          />
                          <h3 className="text-base font-bold text-white">
                            {project.name}
                          </h3>
                        </div>
                        {project.description && (
                          <p className="text-xs text-zinc-500 mt-1">
                            {project.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(project.id)}
                        title="Delete Project"
                        className="rounded-lg p-1.5 text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Tasks List */}
                    <div className="space-y-2.5">
                      {project.tasks.map((task) => {
                        const isExpanded =
                          expandedTasks[task.id] ?? task.subtasks.length > 0;
                        const completedSubs = task.subtasks.filter(
                          (s) => s.completed
                        ).length;

                        return (
                          <div
                            key={task.id}
                            className="rounded-xl border border-white/[0.07] bg-[#131318] p-3.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => handleToggleTask(task)}
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
                                    setExpandedTasks((prev) => ({
                                      ...prev,
                                      [task.id]: !isExpanded,
                                    }))
                                  }
                                  className="flex items-center gap-1.5 text-left min-w-0"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  )}
                                  <span
                                    className={`text-sm font-semibold truncate ${
                                      task.completed
                                        ? 'line-through text-zinc-500'
                                        : 'text-zinc-100'
                                    }`}
                                  >
                                    {task.title}
                                  </span>
                                </button>

                                {task.subtasks.length > 0 && (
                                  <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                                    {completedSubs}/{task.subtasks.length}
                                  </span>
                                )}

                                {task.scheduled_date && (
                                  <button
                                    type="button"
                                    onClick={() => openScheduleEditor(task)}
                                    title="Edit task schedule"
                                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] hover:border-white/25 px-2 py-0.5 text-[10px] font-mono text-zinc-300 shrink-0 transition"
                                  >
                                    <Calendar className="w-2.5 h-2.5 text-zinc-400" />
                                    <span>
                                      {formatShortDateLabel(
                                        task.scheduled_date
                                      )}
                                      {task.scheduled_time
                                        ? ` · ${task.scheduled_time}`
                                        : ''}
                                    </span>
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {task.time_spent_seconds > 0 && (
                                  <span className="text-[11px] font-mono text-zinc-500 mr-1">
                                    {formatLoggedDuration(
                                      task.time_spent_seconds
                                    )}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openScheduleEditor(task)}
                                  title={
                                    task.scheduled_date
                                      ? 'Edit task schedule'
                                      : 'Schedule task'
                                  }
                                  aria-label={`Schedule ${task.title}`}
                                  className={`rounded-lg p-1.5 transition ${
                                    schedulingTaskId === task.id ||
                                    task.scheduled_date
                                      ? 'bg-white/10 text-white hover:bg-white/20'
                                      : 'text-zinc-500 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onStartWork({
                                      boardId: activeBoard.id,
                                      projectId: project.id,
                                      taskId: task.id,
                                      subtaskId: null,
                                    })
                                  }
                                  title="Work on this task"
                                  className="inline-flex items-center gap-1 rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 px-2.5 py-1 text-[11px] font-semibold transition"
                                >
                                  <Play className="w-2.5 h-2.5 fill-[#0A0A0C]" />
                                  <span>Work</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  title="Delete task"
                                  className="rounded-lg p-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300 transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Inline Task Schedule Editor */}
                            {schedulingTaskId === task.id && (
                              <form
                                onSubmit={(e) => handleSaveSchedule(e, task.id)}
                                className="mt-3 rounded-xl border border-white/15 bg-[#0A0A0C] p-3 flex flex-wrap items-end gap-2.5"
                              >
                                <div className="flex-1 min-w-[130px]">
                                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                                    Date
                                  </label>
                                  <input
                                    type="date"
                                    required
                                    value={scheduleDateDraft}
                                    onChange={(e) =>
                                      setScheduleDateDraft(e.target.value)
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-[#141418] px-2.5 py-1.5 text-xs text-white focus:border-white/30 focus:outline-none [color-scheme:dark]"
                                  />
                                </div>

                                <div className="w-28">
                                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                                    Time (opt)
                                  </label>
                                  <input
                                    type="time"
                                    value={scheduleTimeDraft}
                                    onChange={(e) =>
                                      setScheduleTimeDraft(e.target.value)
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-[#141418] px-2.5 py-1.5 text-xs text-white focus:border-white/30 focus:outline-none [color-scheme:dark]"
                                  />
                                </div>

                                <div className="w-24">
                                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                                    Duration
                                  </label>
                                  <select
                                    value={scheduleDurationDraft}
                                    onChange={(e) =>
                                      setScheduleDurationDraft(
                                        Number(e.target.value)
                                      )
                                    }
                                    className="w-full rounded-lg border border-white/10 bg-[#141418] px-2 py-1.5 text-xs text-white focus:border-white/30 focus:outline-none"
                                  >
                                    {![
                                      15, 25, 30, 45, 50, 60, 90, 120, 180, 240,
                                    ].includes(scheduleDurationDraft) && (
                                      <option value={scheduleDurationDraft}>
                                        {scheduleDurationDraft}m
                                      </option>
                                    )}
                                    <option value={15}>15m</option>
                                    <option value={25}>25m</option>
                                    <option value={30}>30m</option>
                                    <option value={45}>45m</option>
                                    <option value={50}>50m</option>
                                    <option value={60}>1h</option>
                                    <option value={90}>1h 30m</option>
                                    <option value={120}>2h</option>
                                    <option value={180}>3h</option>
                                    <option value={240}>4h</option>
                                  </select>
                                </div>

                                <div className="flex items-center gap-1.5 ml-auto">
                                  {task.scheduled_date && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        handleClearSchedule(task.id)
                                      }
                                      className="rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 transition"
                                    >
                                      Clear
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setSchedulingTaskId(null)}
                                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-white transition"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={busy}
                                    className="rounded-lg bg-white text-[#0A0A0C] hover:bg-zinc-200 px-3 py-1.5 text-[11px] font-semibold transition"
                                  >
                                    Save
                                  </button>
                                </div>
                              </form>
                            )}

                            {/* Optional Subtasks Section */}
                            {isExpanded && (
                              <div className="mt-3 pl-6 space-y-1.5 border-l border-white/10 ml-2">
                                {task.subtasks.map((sub) => (
                                  <div
                                    key={sub.id}
                                    className="group/sub flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleToggleSubtask(
                                            sub.id,
                                            sub.completed
                                          )
                                        }
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
                                      <span
                                        className={`text-xs truncate ${
                                          sub.completed
                                            ? 'line-through text-zinc-500'
                                            : 'text-zinc-300'
                                        }`}
                                      >
                                        {sub.title}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {sub.time_spent_seconds > 0 && (
                                        <span className="text-[10px] font-mono text-zinc-500">
                                          {formatLoggedDuration(
                                            sub.time_spent_seconds
                                          )}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onStartWork({
                                            boardId: activeBoard.id,
                                            projectId: project.id,
                                            taskId: task.id,
                                            subtaskId: sub.id,
                                          })
                                        }
                                        title="Work on this subtask"
                                        aria-label={`Work on ${sub.title}`}
                                        className="opacity-70 group-hover/sub:opacity-100 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-[#1B1B22] hover:bg-white hover:text-[#0A0A0C] text-zinc-200 transition"
                                      >
                                        <Play className="w-2.5 h-2.5 fill-current" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteSubtask(sub.id)
                                        }
                                        title="Delete subtask"
                                        className="opacity-0 group-hover/sub:opacity-100 rounded p-0.5 text-zinc-500 hover:text-rose-300 transition"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                ))}

                                {/* Add Subtask Input */}
                                <form
                                  onSubmit={(e) =>
                                    handleCreateSubtask(e, task.id)
                                  }
                                  className="flex items-center gap-1.5 pt-1"
                                >
                                  <input
                                    type="text"
                                    value={subtaskDrafts[task.id] || ''}
                                    onChange={(e) =>
                                      setSubtaskDrafts((prev) => ({
                                        ...prev,
                                        [task.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="+ Add optional subtask..."
                                    className="flex-1 rounded-lg border border-white/[0.06] bg-[#0B0B0E] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
                                  />
                                  <button
                                    type="submit"
                                    disabled={
                                      busy ||
                                      !(subtaskDrafts[task.id] || '').trim()
                                    }
                                    className="rounded-lg border border-white/10 bg-[#1B1B22] hover:bg-white hover:text-[#0A0A0C] disabled:opacity-30 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition"
                                  >
                                    Add
                                  </button>
                                </form>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Add Task to Project */}
                  <form
                    onSubmit={(e) => handleCreateTask(e, project.id)}
                    className="mt-4 pt-3 border-t border-white/[0.06] flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={taskDrafts[project.id] || ''}
                      onChange={(e) =>
                        setTaskDrafts((prev) => ({
                          ...prev,
                          [project.id]: e.target.value,
                        }))
                      }
                      placeholder="+ New task in this project..."
                      className="flex-1 rounded-xl border border-white/10 bg-[#141418] px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busy || !(taskDrafts[project.id] || '').trim()}
                      className="rounded-full bg-white text-[#0A0A0C] hover:bg-zinc-200 disabled:opacity-30 px-3.5 py-2 text-xs font-semibold transition"
                    >
                      Add Task
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
