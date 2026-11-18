import type {
  FocusSession,
  Project,
  Subtask,
  Task,
  TaskBoard,
  TimerMode,
  User,
} from '@/types/kanso';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ||
  'http://localhost:4000';

const SESSION_HINT_KEY = 'kanso_session_hint';
const LEGACY_TOKEN_KEY = 'kanso_auth_token';

// Short-lived JWT access token lives strictly in memory (never in localStorage).
let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<User | null> | null = null;
let onSessionLostCallback: (() => void) | null = null;

export function setOnSessionLost(cb: (() => void) | null): void {
  onSessionLostCallback = cb;
}

export function hasSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSessionHint(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    if (active) {
      window.localStorage.setItem(SESSION_HINT_KEY, '1');
    } else {
      window.localStorage.removeItem(SESSION_HINT_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

function setSessionState(accessToken: string | null, activeHint: boolean): void {
  inMemoryAccessToken = accessToken;
  setSessionHint(activeHint);
}

export interface ApiRequestError extends Error {
  status?: number;
  code?: string;
  retryAfter?: number;
  data?: Record<string, unknown>;
}

const SKIP_REFRESH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/oauth/exchange',
]);

async function buildApiError(res: Response): Promise<ApiRequestError> {
  const data = await res.json().catch(() => ({}));
  const err: ApiRequestError = new Error(
    data.error || data.message || `Request failed (${res.status})`
  );
  err.status = res.status;
  err.code = typeof data.code === 'string' ? data.code : undefined;
  err.retryAfter =
    typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
  err.data = data;
  return err;
}

export async function refreshSession(): Promise<User | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          setSessionState(null, false);
          return null;
        }
        const data = (await res.json()) as {
          accessToken: string;
          user: User;
        };
        setSessionState(data.accessToken, true);
        return data.user;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };
    if (inMemoryAccessToken) {
      headers.Authorization = `Bearer ${inMemoryAccessToken}`;
    }
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  };

  let res = await send();

  if (res.status === 401 && !SKIP_REFRESH_PATHS.has(path)) {
    const refreshedUser = await refreshSession();
    if (!refreshedUser) {
      onSessionLostCallback?.();
      throw await buildApiError(res);
    }
    res = await send();
  }

  if (!res.ok) {
    throw await buildApiError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json().catch(() => ({}))) as T;
}

export const api = {
  register: (email: string, password: string, name?: string) =>
    request<{
      status: 'verification_sent';
      email: string;
      expiresInMinutes: number;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name: name || undefined }),
    }),

  verifyEmail: async (token: string) => {
    const data = await request<{ accessToken: string; user: User }>(
      '/api/auth/verify-email',
      {
        method: 'POST',
        body: JSON.stringify({ token }),
      }
    );
    setSessionState(data.accessToken, true);
    return data;
  },

  resendVerification: (email: string) =>
    request<{
      status: 'verification_sent';
      email: string;
      expiresInMinutes: number;
      retryAfter?: number;
    }>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  login: async (email: string, password: string) => {
    const data = await request<{ accessToken: string; user: User }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );
    setSessionState(data.accessToken, true);
    return data;
  },

  exchangeOAuthTicket: async (ticket: string) => {
    const data = await request<{ accessToken: string; user: User }>(
      '/api/auth/oauth/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ ticket }),
      }
    );
    setSessionState(data.accessToken, true);
    return data;
  },

  refresh: () => refreshSession(),

  logout: async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore network error; clear local session state regardless
    } finally {
      setSessionState(null, false);
    }
  },

  oauthUrl: (provider: 'google' | 'github') =>
    `${API_BASE}/auth/${provider}`,

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

  createTask: (payload: {
    project_id: number;
    title: string;
    scheduled_date?: string | null;
    scheduled_time?: string | null;
    scheduled_duration_minutes?: number;
  }) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTask: (
    id: number,
    payload: {
      title?: string;
      completed?: boolean;
      add_seconds?: number;
      scheduled_date?: string | null;
      scheduled_time?: string | null;
      scheduled_duration_minutes?: number;
      mode?: TimerMode;
      session_date?: string;
      started_at?: string | null;
    }
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
    payload: {
      title?: string;
      completed?: boolean;
      add_seconds?: number;
      mode?: TimerMode;
      session_date?: string;
      started_at?: string | null;
    }
  ) =>
    request<Subtask>(`/api/subtasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteSubtask: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/subtasks/${id}`, {
      method: 'DELETE',
    }),

  getFocusSessions: (params?: { from?: string; to?: string }) => {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return request<{ sessions: FocusSession[] }>(
      `/api/focus-sessions${qs ? `?${qs}` : ''}`
    );
  },

  createFocusSession: (payload: {
    task_id: number;
    subtask_id?: number | null;
    duration_minutes: number;
    session_date: string;
    start_time?: string | null;
    mode?: TimerMode;
    tz_offset_minutes?: number;
  }) =>
    request<FocusSession>('/api/focus-sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteFocusSession: (id: number) =>
    request<{ deleted: boolean; id: number }>(`/api/focus-sessions/${id}`, {
      method: 'DELETE',
    }),
};
