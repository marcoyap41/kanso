export interface User {
  id: number;
  username: string;
  created_at?: string;
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  completed: boolean;
  time_spent_seconds: number;
  created_at?: string;
}

export interface Task {
  id: number;
  project_id: number;
  title: string;
  completed: boolean;
  time_spent_seconds: number;
  created_at?: string;
  subtasks: Subtask[];
}

export interface Project {
  id: number;
  board_id: number;
  name: string;
  description: string;
  created_at?: string;
  tasks: Task[];
}

export interface TaskBoard {
  id: number;
  name: string;
  color: string;
  position: number;
  created_at?: string;
  projects: Project[];
}

export interface FocusSelection {
  boardId: number | null;
  projectId: number | null;
  taskId: number | null;
  subtaskId: number | null;
}

export type TimerMode = 'pomodoro' | 'normal';
export type PomodoroPreset = '25:5' | '50:10' | 'custom';
export type PomodoroPhase = 'work' | 'break';

/**
 * Page indices match horizontal spatial layout:
 * 0: Task Management (Left) <- 1: Home (Center) -> 2: Calendar (Right)
 */
export type PageIndex = 0 | 1 | 2;

export const BOARD_COLOR_PALETTE = [
  { label: 'Pure White', hex: '#FFFFFF' },
  { label: 'Sky', hex: '#38BDF8' },
  { label: 'Violet', hex: '#A78BFA' },
  { label: 'Emerald', hex: '#34D399' },
  { label: 'Amber', hex: '#FBBF24' },
  { label: 'Rose', hex: '#FB7185' },
  { label: 'Orange', hex: '#FB923C' },
] as const;

export const MAX_TASK_BOARDS = 5;
