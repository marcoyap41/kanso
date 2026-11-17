import type { Project, Subtask, Task, TaskBoard, User } from '@/types/kanso';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ||
  'http://localhost:4000';

const TOKEN_STORAGE_KEY = 'kanso_auth_token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<{ user: User }>('/api/auth/me'),

  getHierarchy: () => request<{ boards: TaskBoard[] }>('/api/hierarchy'),

  createBoard: (payload: { name: string; color: string }) =>
    request<TaskBoard>('/api/boards', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateBoard: (id: number, payload: { name?: string; color?: string }) =>
    request<TaskBoard>(`/api/boards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteBoard: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/boards/${id}`, {
      method: 'DELETE',
    }),

  createProject: (payload: {
    board_id: number;
    name: string;
    description?: string;
  }) =>
    request<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProject: (
    id: number,
    payload: { name?: string; description?: string }
  ) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProject: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),

  createTask: (payload: { project_id: number; title: string }) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTask: (
    id: number,
    payload: { title?: string; completed?: boolean; add_seconds?: number }
  ) =>
    request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteTask: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/tasks/${id}`, {
      method: 'DELETE',
    }),

  createSubtask: (payload: { task_id: number; title: string }) =>
    request<Subtask>('/api/subtasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSubtask: (
    id: number,
    payload: { title?: string; completed?: boolean; add_seconds?: number }
  ) =>
    request<Subtask>(`/api/subtasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteSubtask: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/subtasks/${id}`, {
      method: 'DELETE',
    }),
};
