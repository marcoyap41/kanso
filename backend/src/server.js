require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createHash, randomBytes } = require('node:crypto');

const { pool, initDb } = require('./db');
const { authMiddleware, JWT_SECRET } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT) || 4000;
const MAX_BOARDS_PER_USER = 5;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

const LINK_TTL_MINUTES = 30;
const LINK_TTL_MS = LINK_TTL_MINUTES * 60 * 1000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_SECONDS = 60;
const COOLDOWN_MS = COOLDOWN_SECONDS * 1000;
const MAX_SENDS_PER_PENDING = 10;
const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;
const REFRESH_COOKIE = 'kanso_rt';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_BASE = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: IS_PROD ? 'none' : 'lax',
  path: '/',
};

const setRefreshCookie = (res, token) =>
  res.cookie(REFRESH_COOKIE, token, { ...COOKIE_BASE, maxAge: REFRESH_TTL_MS });

const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, COOKIE_BASE);

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const oauthStates = new Map();
const oauthTickets = new Map();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origin === FRONTEND_URL || /^http:\/\/localhost:\d+$/.test(origin)) {
        return cb(null, true);
      }
      return cb(null, FRONTEND_URL);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use((req, _res, next) => {
  const cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) {
          try {
            cookies[key] = decodeURIComponent(val);
          } catch {
            cookies[key] = val;
          }
        }
      }
    }
  }
  req.cookies = cookies;
  next();
});

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const normalizeEmail = (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');
const isValidEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function pruneExpired(map) {
  const now = Date.now();
  for (const [k, v] of map.entries()) {
    if (v.expiresAt <= now) map.delete(k);
  }
}

function formatUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || null,
    username: row.name || row.username || row.email.split('@')[0],
    created_at: row.created_at,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function startSession(userRow, res) {
  const user = formatUser(userRow);
  const refreshToken = randomBytes(48).toString('base64url');
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, sha256(refreshToken), new Date(Date.now() + REFRESH_TTL_MS)]
  );
  setRefreshCookie(res, refreshToken);
  return {
    accessToken: signAccessToken(user),
    user,
  };
}

async function sendVerificationEmail(to, link, ttlMinutes) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim() || 'Kanso <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn(`[DEV MAIL] RESEND_API_KEY not set. Verification link for ${to}: ${link}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: 'Verify your email for kanso',
      text: `Welcome to kanso!\n\nConfirm your email address to finish creating your account:\n${link}\n\nThis link expires in ${ttlMinutes} minutes. If you did not sign up for kanso, you can ignore this email.`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
          <h2 style="margin:0 0 12px">Welcome to kanso</h2>
          <p style="margin:0 0 20px">Confirm your email address to finish creating your account.</p>
          <a href="${link}" style="display:inline-block;padding:11px 18px;background:#0A0A0C;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verify email</a>
          <p style="margin:20px 0 0;font-size:13px;color:#555">This link expires in ${ttlMinutes} minutes. If you did not sign up for kanso, you can ignore this email.</p>
          <p style="margin:12px 0 0;font-size:12px;color:#888;word-break:break-all">${link}</p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`Resend failed for ${to}: ${res.status} ${errText}`);
    const err = new Error('Could not send the verification email. Please try again later.');
    err.status = 503;
    throw err;
  }
}

async function issueVerification(email, name, passwordHash, existingPending = null) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const tokenExpiresAt = new Date(Date.now() + LINK_TTL_MS);
  const pendingExpiresAt = new Date(Date.now() + PENDING_TTL_MS);
  const nextSendCount = existingPending ? Number(existingPending.send_count || 1) + 1 : 1;

  await pool.query(
    `INSERT INTO pending_signups (email, name, password_hash, token_hash, token_expires_at, pending_expires_at, last_sent_at, send_count)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, pending_signups.name),
       password_hash = EXCLUDED.password_hash,
       token_hash = EXCLUDED.token_hash,
       token_expires_at = EXCLUDED.token_expires_at,
       pending_expires_at = EXCLUDED.pending_expires_at,
       last_sent_at = NOW(),
       send_count = EXCLUDED.send_count`,
    [email, name, passwordHash, tokenHash, tokenExpiresAt, pendingExpiresAt, nextSendCount]
  );

  const link = `${FRONTEND_URL}/#verify=${token}`;
  try {
    await sendVerificationEmail(email, link, LINK_TTL_MINUTES);
  } catch (err) {
    if (!existingPending) {
      await pool.query('DELETE FROM pending_signups WHERE email = $1', [email]).catch(() => {});
    } else {
      await pool.query(
        `UPDATE pending_signups
         SET last_sent_at = $2, send_count = $3, token_hash = $4
         WHERE email = $1`,
        [email, existingPending.last_sent_at, existingPending.send_count, existingPending.token_hash]
      ).catch(() => {});
    }
    throw err;
  }
}

function getCallbackUrl(provider, req) {
  const envKey = provider === 'google' ? 'GOOGLE_CALLBACK_URL' : 'GITHUB_CALLBACK_URL';
  const explicit = process.env[envKey]?.trim();
  if (explicit) return explicit;
  const base = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
  return `${base}/auth/${provider}/callback`;
}

function getOAuthAuthorizationUrl(provider, req) {
  pruneExpired(oauthStates);
  const state = randomBytes(24).toString('base64url');
  oauthStates.set(sha256(state), { provider, expiresAt: Date.now() + STATE_TTL_MS });

  const redirectUri = getCallbackUrl(provider, req);

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new Error('Google sign-in is not configured on the server.');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('GitHub sign-in is not configured on the server.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

async function verifyGoogleCode(code, redirectUri) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('Google sign-in is not configured on the server.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    throw new Error('Failed to exchange Google authorization code.');
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Google did not return an access token.');
  }

  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error('Failed to fetch Google user profile.');
  }

  const profile = await userRes.json();
  if (!profile.sub || !profile.email) {
    throw new Error('Google account did not provide an email address.');
  }
  if (profile.email_verified === false) {
    throw new Error('Your Google email address is not verified.');
  }

  return {
    provider: 'google',
    providerUserId: String(profile.sub),
    email: profile.email.trim().toLowerCase(),
    name: profile.name?.trim().slice(0, 50) || null,
  };
}

async function verifyGithubCode(code, redirectUri) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('GitHub sign-in is not configured on the server.');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error('Failed to exchange GitHub authorization code.');
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('GitHub did not return an access token.');
  }

  const ghHeaders = {
    Authorization: `Bearer ${tokenData.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Kanso-API',
  };

  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', { headers: ghHeaders }),
    fetch('https://api.github.com/user/emails', { headers: ghHeaders }),
  ]);

  if (!userRes.ok) {
    throw new Error('Failed to fetch GitHub user profile.');
  }

  const ghUser = await userRes.json();
  if (!ghUser.id) {
    throw new Error('Invalid GitHub user profile.');
  }

  let email = null;
  if (emailsRes.ok) {
    const emails = await emailsRes.json();
    const primaryVerified = emails.find((e) => e.primary && e.verified);
    const anyVerified = emails.find((e) => e.verified);
    email = (primaryVerified || anyVerified)?.email || null;
  }

  if (!email && ghUser.email) {
    email = ghUser.email;
  }

  if (!email) {
    throw new Error('Your GitHub account does not have a verified email address.');
  }

  const rawName = (ghUser.name || ghUser.login || '').trim();
  return {
    provider: 'github',
    providerUserId: String(ghUser.id),
    email: email.trim().toLowerCase(),
    name: rawName ? rawName.slice(0, 50) : null,
  };
}

async function authenticateOAuthCallback(provider, code, state, req) {
  if (!code || !state) {
    throw new Error('Missing OAuth authorization code or state.');
  }

  pruneExpired(oauthStates);
  const stateKey = sha256(state);
  const stored = oauthStates.get(stateKey);
  oauthStates.delete(stateKey);

  if (!stored || stored.provider !== provider || stored.expiresAt <= Date.now()) {
    throw new Error('OAuth session expired or invalid. Please try signing in again.');
  }

  const redirectUri = getCallbackUrl(provider, req);
  if (provider === 'google') {
    return verifyGoogleCode(code, redirectUri);
  }
  return verifyGithubCode(code, redirectUri);
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const isValidDateKey = (val) =>
  typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);

const isValidTimeStr = (val) =>
  typeof val === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(val);

function parseDurationMinutes(raw, fallback = 60) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.max(15, Math.min(720, Math.round(num)));
}

/**
 * Look up board/project/task/subtask metadata for focus session logging.
 */
async function fetchFocusTargetMeta(userId, table, itemId) {
  if (table === 'subtasks') {
    const res = await pool.query(
      `SELECT s.id AS subtask_id, s.title AS subtask_title,
              t.id AS task_id, t.title AS task_title,
              p.id AS project_id, p.name AS project_name,
              b.id AS board_id, b.name AS board_name, b.color AS board_color
       FROM subtasks s
       JOIN tasks t ON t.id = s.task_id
       JOIN projects p ON p.id = t.project_id
       JOIN task_boards b ON b.id = p.board_id
       WHERE s.id = $1 AND s.user_id = $2`,
      [itemId, userId]
    );
    return res.rows[0] || null;
  }

  const res = await pool.query(
    `SELECT NULL::integer AS subtask_id, NULL::text AS subtask_title,
            t.id AS task_id, t.title AS task_title,
            p.id AS project_id, p.name AS project_name,
            b.id AS board_id, b.name AS board_name, b.color AS board_color
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     JOIN task_boards b ON b.id = p.board_id
     WHERE t.id = $1 AND t.user_id = $2`,
    [itemId, userId]
  );
  return res.rows[0] || null;
}

/**
 * Record a completed focus session block when a session ends.
 */
async function recordFocusSessionDelta(userId, table, updatedRow, delta, body) {
  const meta = await fetchFocusTargetMeta(userId, table, updatedRow.id);
  if (!meta) return;

  const rawDate =
    typeof body?.session_date === 'string' ? body.session_date.trim() : '';
  const sessionDate = isValidDateKey(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);
  const mode = body?.mode === 'normal' ? 'normal' : 'pomodoro';

  const endedAt = new Date();
  let startedAt = null;
  if (typeof body?.started_at === 'string' && body.started_at.trim()) {
    const parsedStart = new Date(body.started_at.trim());
    if (!Number.isNaN(parsedStart.getTime()) && parsedStart < endedAt) {
      startedAt = parsedStart;
    }
  }
  if (!startedAt) {
    startedAt = new Date(endedAt.getTime() - delta * 1000);
  }

  await pool.query(
    `INSERT INTO focus_sessions (
       user_id, board_id, project_id, task_id, subtask_id,
       task_title, subtask_title, project_name, board_name, board_color,
       mode, duration_seconds, started_at, ended_at, session_date
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15
     )`,
    [
      userId,
      meta.board_id,
      meta.project_id,
      meta.task_id,
      meta.subtask_id,
      meta.task_title || 'Focus Session',
      meta.subtask_title || null,
      meta.project_name || '',
      meta.board_name || '',
      meta.board_color || '#FFFFFF',
      mode,
      delta,
      startedAt,
      endedAt,
      sessionDate,
    ]
  );
}

/**
 * Verify a parent entity exists and belongs to the authenticated user.
 */
async function ensureOwned(table, id, userId) {
  const result = await pool.query(
    `SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rowCount > 0;
}

/**
 * Assemble the 4-level hierarchy (boards -> projects -> tasks -> subtasks) for a user.
 */
async function fetchUserHierarchy(userId) {
  const [boardsRes, projectsRes, tasksRes, subtasksRes] = await Promise.all([
    pool.query(
      `SELECT id, name, color, position, created_at
       FROM task_boards
       WHERE user_id = $1
       ORDER BY position ASC, id ASC`,
      [userId]
    ),
    pool.query(
      `SELECT id, board_id, name, description, created_at
       FROM projects
       WHERE user_id = $1
       ORDER BY id ASC`,
      [userId]
    ),
    pool.query(
      `SELECT id, project_id, title, completed, time_spent_seconds,
              scheduled_date, scheduled_time, scheduled_duration_minutes, created_at
       FROM tasks
       WHERE user_id = $1
       ORDER BY id ASC`,
      [userId]
    ),
    pool.query(
      `SELECT id, task_id, title, completed, time_spent_seconds, created_at
       FROM subtasks
       WHERE user_id = $1
       ORDER BY id ASC`,
      [userId]
    ),
  ]);

  const subtasksByTask = new Map();
  for (const sub of subtasksRes.rows) {
    if (!subtasksByTask.has(sub.task_id)) subtasksByTask.set(sub.task_id, []);
    subtasksByTask.get(sub.task_id).push(sub);
  }

  const tasksByProject = new Map();
  for (const task of tasksRes.rows) {
    if (!tasksByProject.has(task.project_id)) tasksByProject.set(task.project_id, []);
    tasksByProject.get(task.project_id).push({
      ...task,
      subtasks: subtasksByTask.get(task.id) || [],
    });
  }

  const projectsByBoard = new Map();
  for (const project of projectsRes.rows) {
    if (!projectsByBoard.has(project.board_id)) projectsByBoard.set(project.board_id, []);
    projectsByBoard.get(project.board_id).push({
      ...project,
      tasks: tasksByProject.get(project.id) || [],
    });
  }

  return boardsRes.rows.map((board) => ({
    ...board,
    projects: projectsByBoard.get(board.id) || [],
  }));
}

/**
 * Shared update handler for tasks and subtasks (title, completed, time_spent_seconds delta, and task schedule).
 */
async function updateTimedItem(table, req, res) {
  const itemId = parseId(req.params.id);
  if (!itemId) return res.status(400).json({ error: 'Invalid ID' });

  const {
    title,
    completed,
    add_seconds,
    scheduled_date,
    scheduled_time,
    scheduled_duration_minutes,
  } = req.body || {};
  const updates = [];
  const values = [];
  let appliedDelta = 0;

  if (typeof title === 'string') {
    const trimmed = title.trim();
    if (!trimmed) return res.status(400).json({ error: 'Title cannot be empty' });
    values.push(trimmed);
    updates.push(`title = $${values.length}`);
  }

  if (typeof completed === 'boolean') {
    values.push(completed);
    updates.push(`completed = $${values.length}`);
  }

  if (table === 'tasks') {
    if (scheduled_date !== undefined) {
      if (scheduled_date === null || scheduled_date === '') {
        values.push(null);
        updates.push(`scheduled_date = $${values.length}`);
      } else if (typeof scheduled_date === 'string' && isValidDateKey(scheduled_date.trim())) {
        values.push(scheduled_date.trim());
        updates.push(`scheduled_date = $${values.length}`);
      } else {
        return res.status(400).json({ error: 'scheduled_date must be YYYY-MM-DD or null' });
      }
    }

    if (scheduled_time !== undefined) {
      if (scheduled_time === null || scheduled_time === '') {
        values.push(null);
        updates.push(`scheduled_time = $${values.length}`);
      } else if (typeof scheduled_time === 'string' && isValidTimeStr(scheduled_time.trim())) {
        values.push(scheduled_time.trim());
        updates.push(`scheduled_time = $${values.length}`);
      } else {
        return res.status(400).json({ error: 'scheduled_time must be HH:MM or null' });
      }
    }

    if (scheduled_duration_minutes !== undefined) {
      const mins = parseDurationMinutes(scheduled_duration_minutes, null);
      if (mins === null) {
        return res.status(400).json({ error: 'scheduled_duration_minutes must be an integer between 15 and 720' });
      }
      values.push(mins);
      updates.push(`scheduled_duration_minutes = $${values.length}`);
    }
  }

  if (add_seconds !== undefined) {
    const delta = Math.floor(Number(add_seconds));
    if (!Number.isFinite(delta) || delta < 0) {
      return res.status(400).json({ error: 'add_seconds must be a non-negative integer' });
    }
    if (delta > 0) {
      appliedDelta = delta;
      values.push(delta);
      updates.push(`time_spent_seconds = time_spent_seconds + $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid update fields provided' });
  }

  values.push(itemId, req.user.id);
  const query = `
    UPDATE ${table}
    SET ${updates.join(', ')}
    WHERE id = $${values.length - 1} AND user_id = $${values.length}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Item not found' });
  }

  if (table === 'tasks' && typeof completed === 'boolean') {
    await pool.query(
      'UPDATE subtasks SET completed = $1 WHERE task_id = $2 AND user_id = $3',
      [completed, itemId, req.user.id]
    );
  }

  if (appliedDelta > 0) {
    await recordFocusSessionDelta(req.user.id, table, result.rows[0], appliedDelta, req.body);
  }

  return res.json(result.rows[0]);
}

async function deleteOwnedItem(table, req, res) {
  const itemId = parseId(req.params.id);
  if (!itemId) return res.status(400).json({ error: 'Invalid ID' });

  const result = await pool.query(
    `DELETE FROM ${table} WHERE id = $1 AND user_id = $2 RETURNING id`,
    [itemId, req.user.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Item not found' });
  }

  return res.json({ deleted: true, id: itemId });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kanso-api' });
});

// Auth routes (mounted at both /api/auth and /auth for OAuth & compatibility)
const authRouter = express.Router();

// Step 1 of sign-up: deferred registration in pending_signups + email verification link (no session yet)
authRouter.post('/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 50) || null : null;

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be between 8 and 72 characters' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [email]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }

    const pendingRes = await pool.query(
      'SELECT * FROM pending_signups WHERE email = $1 AND pending_expires_at > NOW()',
      [email]
    );
    const existingPending = pendingRes.rows[0] || null;
    if (existingPending) {
      const elapsedMs = Date.now() - new Date(existingPending.last_sent_at).getTime();
      if (elapsedMs < COOLDOWN_MS) {
        const retryAfter = Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 1000));
        return res.status(429).json({
          error: `Please wait ${retryAfter} seconds before requesting another verification email.`,
          retryAfter,
        });
      }
      if (Number(existingPending.send_count || 0) >= MAX_SENDS_PER_PENDING) {
        return res.status(429).json({
          error: 'Too many verification emails. Please try again later.',
          retryAfter: 3600,
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await issueVerification(email, name, passwordHash, existingPending);

    return res.status(202).json({
      status: 'verification_sent',
      email,
      expiresInMinutes: LINK_TTL_MINUTES,
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Failed to register account',
    });
  }
});

// Step 2 of sign-up: consume verification link token -> create user (no starter board) + return JWT session
authRouter.post('/verify-email', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 200) {
    return res.status(400).json({
      error: 'This verification link is invalid or has expired. Sign up again or request a new link.',
    });
  }

  const tokenHash = sha256(token);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const consumed = await client.query(
      `DELETE FROM pending_signups
       WHERE token_hash = $1 AND token_expires_at > NOW()
       RETURNING email, name, password_hash`,
      [tokenHash]
    );

    if (consumed.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This verification link is invalid or has expired. Sign up again or request a new link.',
      });
    }

    const pending = consumed.rows[0];
    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [pending.email]
    );
    if (existing.rowCount > 0) {
      await client.query('COMMIT');
      return res.status(409).json({
        error: 'This email is already verified. Sign in instead.',
      });
    }

    const username = pending.name || pending.email.split('@')[0];
    const inserted = await client.query(
      `INSERT INTO users (email, name, username, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, username, created_at`,
      [pending.email, pending.name, username, pending.password_hash]
    );

    await client.query('COMMIT');
    const session = await startSession(inserted.rows[0], res);
    return res.status(200).json(session);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'This email is already verified. Sign in instead.' });
    }
    console.error('Verify email error:', err);
    return res.status(500).json({ error: 'Failed to verify email' });
  } finally {
    client.release();
  }
});

// Resend verification email for an unverified pending signup
authRouter.post('/resend-verification', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    const pendingRes = await pool.query(
      'SELECT * FROM pending_signups WHERE email = $1 AND pending_expires_at > NOW()',
      [email]
    );
    const pending = pendingRes.rows[0] || null;

    if (pending) {
      const elapsedMs = Date.now() - new Date(pending.last_sent_at).getTime();
      if (elapsedMs < COOLDOWN_MS) {
        const retryAfter = Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 1000));
        return res.status(429).json({
          error: `Too many verification emails. Please try again in ${retryAfter} seconds.`,
          retryAfter,
        });
      }
      if (Number(pending.send_count || 0) >= MAX_SENDS_PER_PENDING) {
        return res.status(429).json({
          error: 'Too many verification emails. Please try again later.',
          retryAfter: 3600,
        });
      }

      await issueVerification(email, pending.name, pending.password_hash, pending);
    }

    return res.status(202).json({
      status: 'verification_sent',
      email,
      expiresInMinutes: LINK_TTL_MINUTES,
      retryAfter: COOLDOWN_SECONDS,
    });
  } catch (err) {
    console.error('Resend verification error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Could not resend verification email',
    });
  }
});

// Direct email + password login (no verification link required once verified)
authRouter.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Valid email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, username, password_hash, created_at FROM users WHERE LOWER(email) = $1',
      [email]
    );

    if (result.rowCount > 0) {
      const row = result.rows[0];
      const valid = await bcrypt.compare(password, row.password_hash || DUMMY_HASH);
      if (!valid || !row.password_hash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const session = await startSession(row, res);
      return res.json(session);
    }

    // Check if there is an unverified pending signup with matching password
    const pendingRes = await pool.query(
      'SELECT * FROM pending_signups WHERE email = $1 AND pending_expires_at > NOW()',
      [email]
    );
    const pending = pendingRes.rows[0] || null;
    const ok = await bcrypt.compare(password, pending?.password_hash || DUMMY_HASH);
    if (!pending || !ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    let retryAfter;
    const elapsedMs = Date.now() - new Date(pending.last_sent_at).getTime();
    if (elapsedMs < COOLDOWN_MS) {
      retryAfter = Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 1000));
    } else if (Number(pending.send_count || 0) < MAX_SENDS_PER_PENDING) {
      await issueVerification(email, pending.name, pending.password_hash, pending).catch(() => {});
    }

    return res.status(403).json({
      code: 'EMAIL_NOT_VERIFIED',
      email,
      retryAfter,
      error:
        retryAfter === undefined
          ? `Your email is not verified yet. We sent a new verification link to ${email}.`
          : `Your email is not verified yet. Use the link we already sent to ${email}.`,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

authRouter.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, username, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: formatUser(result.rows[0]) });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Failed to load user profile' });
  }
});

authRouter.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw || typeof raw !== 'string') {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Invalid refresh token!' });
  }

  try {
    const rowRes = await pool.query(
      'SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = $1',
      [sha256(raw)]
    );
    const row = rowRes.rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      if (row) {
        await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [row.id]);
      }
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token!' });
    }

    // Atomically rotate refresh token so reuse fails
    const delRes = await pool.query(
      'DELETE FROM refresh_tokens WHERE id = $1 RETURNING id',
      [row.id]
    );
    if (delRes.rowCount === 0) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token!' });
    }

    const userRes = await pool.query(
      'SELECT id, email, name, username, created_at FROM users WHERE id = $1',
      [row.user_id]
    );
    if (userRes.rowCount === 0) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token!' });
    }

    const session = await startSession(userRes.rows[0], res);
    return res.status(200).json(session);
  } catch (err) {
    clearRefreshCookie(res);
    console.error('Refresh token error:', err);
    return res.status(500).json({ error: 'Failed to refresh session' });
  }
});

authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  clearRefreshCookie(res);
  if (raw && typeof raw === 'string') {
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [sha256(raw)]).catch(() => {});
  }
  return res.status(200).json({ ok: true });
});

function startOAuth(provider, req, res) {
  try {
    const url = getOAuthAuthorizationUrl(provider, req);
    return res.redirect(url);
  } catch (err) {
    const msg = err?.message || `Could not start ${provider} sign-in.`;
    return res.redirect(`${FRONTEND_URL}/#auth_error=${encodeURIComponent(msg)}`);
  }
}

async function finishOAuth(provider, req, res) {
  const { code, state, error } = req.query;
  if (error) {
    const msg = error === 'access_denied' ? 'Sign-in was cancelled.' : `OAuth error: ${error}`;
    return res.redirect(`${FRONTEND_URL}/#auth_error=${encodeURIComponent(String(msg))}`);
  }

  try {
    const profile = await authenticateOAuthCallback(
      provider,
      typeof code === 'string' ? code : undefined,
      typeof state === 'string' ? state : undefined,
      req
    );

    let user = null;
    const linked = await pool.query(
      'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
      [profile.provider, profile.providerUserId]
    );

    if (linked.rowCount > 0) {
      const userRes = await pool.query(
        'SELECT id, email, name, username, created_at FROM users WHERE id = $1',
        [linked.rows[0].user_id]
      );
      if (userRes.rowCount > 0) user = userRes.rows[0];
    }

    if (!user) {
      const existingUser = await pool.query(
        'SELECT id, email, name, username, created_at FROM users WHERE LOWER(email) = $1',
        [profile.email]
      );
      if (existingUser.rowCount > 0) {
        user = existingUser.rows[0];
      } else {
        const username = profile.name || profile.email.split('@')[0];
        const inserted = await pool.query(
          `INSERT INTO users (email, name, username, password_hash)
           VALUES ($1, $2, $3, NULL)
           RETURNING id, email, name, username, created_at`,
          [profile.email, profile.name, username]
        );
        user = inserted.rows[0];
      }

      await pool.query(
        `INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_user_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
        [profile.provider, profile.providerUserId, user.id]
      );

      await pool.query('DELETE FROM pending_signups WHERE email = $1', [profile.email]);
    }

    await startSession(user, res);

    pruneExpired(oauthTickets);
    const ticket = randomBytes(32).toString('base64url');
    oauthTickets.set(sha256(ticket), {
      userId: user.id,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });

    return res.redirect(`${FRONTEND_URL}/#auth=success&ticket=${encodeURIComponent(ticket)}`);
  } catch (err) {
    const msg = err?.message || `Could not complete ${provider} sign-in.`;
    return res.redirect(`${FRONTEND_URL}/#auth_error=${encodeURIComponent(msg)}`);
  }
}

authRouter.get('/google', (req, res) => startOAuth('google', req, res));
authRouter.get('/google/callback', (req, res) => finishOAuth('google', req, res));
authRouter.get('/github', (req, res) => startOAuth('github', req, res));
authRouter.get('/github/callback', (req, res) => finishOAuth('github', req, res));

authRouter.post('/oauth/exchange', async (req, res) => {
  const ticket = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : '';
  if (!ticket) {
    return res.status(401).json({ error: 'Invalid OAuth ticket.' });
  }

  pruneExpired(oauthTickets);
  const ticketKey = sha256(ticket);
  const stored = oauthTickets.get(ticketKey);
  oauthTickets.delete(ticketKey);

  if (!stored || stored.expiresAt <= Date.now()) {
    return res.status(401).json({ error: 'OAuth sign-in ticket expired or already used.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, username, created_at FROM users WHERE id = $1',
      [stored.userId]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }
    const session = await startSession(result.rows[0], res);
    return res.status(200).json(session);
  } catch (err) {
    console.error('OAuth exchange error:', err);
    return res.status(500).json({ error: 'Failed to complete OAuth sign-in' });
  }
});

app.use(['/api/auth', '/auth'], authRouter);

// Protected hierarchy route
app.get('/api/hierarchy', authMiddleware, async (req, res) => {
  try {
    const boards = await fetchUserHierarchy(req.user.id);
    return res.json({ boards });
  } catch (err) {
    console.error('Hierarchy error:', err);
    return res.status(500).json({ error: 'Failed to load hierarchy' });
  }
});

// Task Boards (max 5 per user)
app.post('/api/boards', authMiddleware, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const color = typeof req.body?.color === 'string' && req.body.color.trim()
    ? req.body.color.trim()
    : '#FFFFFF';

  if (!name) return res.status(400).json({ error: 'Board name is required' });

  try {
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS total, COALESCE(MAX(position), -1)::int AS max_pos FROM task_boards WHERE user_id = $1',
      [req.user.id]
    );
    const { total, max_pos } = countRes.rows[0];
    if (total >= MAX_BOARDS_PER_USER) {
      return res.status(400).json({ error: 'Maximum of 5 Task Boards allowed' });
    }

    const insertRes = await pool.query(
      `INSERT INTO task_boards (user_id, name, color, position)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, color, position, created_at`,
      [req.user.id, name, color, max_pos + 1]
    );

    return res.status(201).json({ ...insertRes.rows[0], projects: [] });
  } catch (err) {
    console.error('Create board error:', err);
    return res.status(500).json({ error: 'Failed to create task board' });
  }
});

app.patch('/api/boards/:id', authMiddleware, async (req, res) => {
  const boardId = parseId(req.params.id);
  if (!boardId) return res.status(400).json({ error: 'Invalid board ID' });

  const { name, color } = req.body || {};
  const updates = [];
  const values = [];

  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) return res.status(400).json({ error: 'Board name cannot be empty' });
    values.push(trimmed);
    updates.push(`name = $${values.length}`);
  }

  if (typeof color === 'string' && color.trim()) {
    values.push(color.trim());
    updates.push(`color = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid update fields provided' });
  }

  values.push(boardId, req.user.id);
  try {
    const result = await pool.query(
      `UPDATE task_boards
       SET ${updates.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING id, name, color, position, created_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task board not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update board error:', err);
    return res.status(500).json({ error: 'Failed to update task board' });
  }
});

app.delete('/api/boards/:id', authMiddleware, async (req, res) => {
  try {
    return await deleteOwnedItem('task_boards', req, res);
  } catch (err) {
    console.error('Delete board error:', err);
    return res.status(500).json({ error: 'Failed to delete task board' });
  }
});

// Projects
app.post('/api/projects', authMiddleware, async (req, res) => {
  const boardId = parseId(req.body?.board_id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

  if (!boardId) return res.status(400).json({ error: 'Valid board_id is required' });
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  try {
    if (!(await ensureOwned('task_boards', boardId, req.user.id))) {
      return res.status(404).json({ error: 'Task board not found' });
    }

    const result = await pool.query(
      `INSERT INTO projects (board_id, user_id, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, board_id, name, description, created_at`,
      [boardId, req.user.id, name, description]
    );
    return res.status(201).json({ ...result.rows[0], tasks: [] });
  } catch (err) {
    console.error('Create project error:', err);
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

app.patch('/api/projects/:id', authMiddleware, async (req, res) => {
  const projectId = parseId(req.params.id);
  if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

  const { name, description } = req.body || {};
  const updates = [];
  const values = [];

  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) return res.status(400).json({ error: 'Project name cannot be empty' });
    values.push(trimmed);
    updates.push(`name = $${values.length}`);
  }

  if (typeof description === 'string') {
    values.push(description.trim());
    updates.push(`description = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid update fields provided' });
  }

  values.push(projectId, req.user.id);
  try {
    const result = await pool.query(
      `UPDATE projects
       SET ${updates.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING id, board_id, name, description, created_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update project error:', err);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

app.delete('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    return await deleteOwnedItem('projects', req, res);
  } catch (err) {
    console.error('Delete project error:', err);
    return res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Tasks
app.post('/api/tasks', authMiddleware, async (req, res) => {
  const projectId = parseId(req.body?.project_id);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const rawDate = req.body?.scheduled_date;
  const rawTime = req.body?.scheduled_time;
  const rawDuration = req.body?.scheduled_duration_minutes;

  if (!projectId) return res.status(400).json({ error: 'Valid project_id is required' });
  if (!title) return res.status(400).json({ error: 'Task title is required' });

  let scheduledDate = null;
  if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
    if (typeof rawDate !== 'string' || !isValidDateKey(rawDate.trim())) {
      return res.status(400).json({ error: 'scheduled_date must be YYYY-MM-DD or null' });
    }
    scheduledDate = rawDate.trim();
  }

  let scheduledTime = null;
  if (rawTime !== undefined && rawTime !== null && rawTime !== '') {
    if (typeof rawTime !== 'string' || !isValidTimeStr(rawTime.trim())) {
      return res.status(400).json({ error: 'scheduled_time must be HH:MM or null' });
    }
    scheduledTime = rawTime.trim();
  }

  const scheduledDuration = parseDurationMinutes(rawDuration, 60);
  if (scheduledDuration === null) {
    return res.status(400).json({ error: 'scheduled_duration_minutes must be an integer between 15 and 720' });
  }

  try {
    if (!(await ensureOwned('projects', projectId, req.user.id))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await pool.query(
      `INSERT INTO tasks (project_id, user_id, title, scheduled_date, scheduled_time, scheduled_duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, title, completed, time_spent_seconds,
                 scheduled_date, scheduled_time, scheduled_duration_minutes, created_at`,
      [projectId, req.user.id, title, scheduledDate, scheduledTime, scheduledDuration]
    );
    return res.status(201).json({ ...result.rows[0], subtasks: [] });
  } catch (err) {
    console.error('Create task error:', err);
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

app.patch('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    return await updateTimedItem('tasks', req, res);
  } catch (err) {
    console.error('Update task error:', err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    return await deleteOwnedItem('tasks', req, res);
  } catch (err) {
    console.error('Delete task error:', err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Subtasks
app.post('/api/subtasks', authMiddleware, async (req, res) => {
  const taskId = parseId(req.body?.task_id);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';

  if (!taskId) return res.status(400).json({ error: 'Valid task_id is required' });
  if (!title) return res.status(400).json({ error: 'Subtask title is required' });

  try {
    if (!(await ensureOwned('tasks', taskId, req.user.id))) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      `INSERT INTO subtasks (task_id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, title, completed, time_spent_seconds, created_at`,
      [taskId, req.user.id, title]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create subtask error:', err);
    return res.status(500).json({ error: 'Failed to create subtask' });
  }
});

app.patch('/api/subtasks/:id', authMiddleware, async (req, res) => {
  try {
    return await updateTimedItem('subtasks', req, res);
  } catch (err) {
    console.error('Update subtask error:', err);
    return res.status(500).json({ error: 'Failed to update subtask' });
  }
});

app.delete('/api/subtasks/:id', authMiddleware, async (req, res) => {
  try {
    return await deleteOwnedItem('subtasks', req, res);
  } catch (err) {
    console.error('Delete subtask error:', err);
    return res.status(500).json({ error: 'Failed to delete subtask' });
  }
});

// Focus Sessions History
app.get('/api/focus-sessions', authMiddleware, async (req, res) => {
  const from = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
  const to = typeof req.query?.to === 'string' ? req.query.to.trim() : '';

  const conditions = ['user_id = $1'];
  const values = [req.user.id];

  if (from) {
    if (!isValidDateKey(from)) {
      return res.status(400).json({ error: 'Invalid from date (expected YYYY-MM-DD)' });
    }
    values.push(from);
    conditions.push(`session_date >= $${values.length}`);
  }

  if (to) {
    if (!isValidDateKey(to)) {
      return res.status(400).json({ error: 'Invalid to date (expected YYYY-MM-DD)' });
    }
    values.push(to);
    conditions.push(`session_date <= $${values.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT id, user_id, board_id, project_id, task_id, subtask_id,
              task_title, subtask_title, project_name, board_name, board_color,
              mode, duration_seconds, started_at, ended_at, session_date
       FROM focus_sessions
       WHERE ${conditions.join(' AND ')}
       ORDER BY started_at DESC`,
      values
    );
    return res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Fetch focus sessions error:', err);
    return res.status(500).json({ error: 'Failed to load focus sessions' });
  }
});

app.post('/api/focus-sessions', authMiddleware, async (req, res) => {
  const taskId = parseId(req.body?.task_id);
  const rawSubtaskId = req.body?.subtask_id;
  const subtaskId =
    rawSubtaskId === undefined || rawSubtaskId === null || rawSubtaskId === ''
      ? null
      : parseId(rawSubtaskId);

  if (!taskId) {
    return res.status(400).json({ error: 'Valid task_id is required' });
  }
  if (rawSubtaskId !== undefined && rawSubtaskId !== null && rawSubtaskId !== '' && !subtaskId) {
    return res.status(400).json({ error: 'Invalid subtask_id' });
  }

  const rawMinutes = Number(req.body?.duration_minutes);
  if (!Number.isFinite(rawMinutes) || rawMinutes < 1 || rawMinutes > 720) {
    return res.status(400).json({ error: 'duration_minutes must be between 1 and 720' });
  }
  const durationMinutes = Math.round(rawMinutes);
  const durationSeconds = durationMinutes * 60;

  const sessionDate =
    typeof req.body?.session_date === 'string' ? req.body.session_date.trim() : '';
  if (!isValidDateKey(sessionDate)) {
    return res.status(400).json({ error: 'session_date must be YYYY-MM-DD' });
  }

  const rawStartTime = req.body?.start_time;
  let startTime = null;
  if (rawStartTime !== undefined && rawStartTime !== null && rawStartTime !== '') {
    if (typeof rawStartTime !== 'string' || !isValidTimeStr(rawStartTime.trim())) {
      return res.status(400).json({ error: 'start_time must be HH:MM' });
    }
    startTime = rawStartTime.trim();
  }

  const mode = req.body?.mode === 'normal' ? 'normal' : 'pomodoro';

  try {
    let meta = null;
    if (subtaskId) {
      meta = await fetchFocusTargetMeta(req.user.id, 'subtasks', subtaskId);
      if (!meta || meta.task_id !== taskId) {
        return res.status(404).json({ error: 'Subtask not found for this task' });
      }
    } else {
      meta = await fetchFocusTargetMeta(req.user.id, 'tasks', taskId);
      if (!meta) {
        return res.status(404).json({ error: 'Task not found' });
      }
    }

    let startedAt;
    let endedAt;
    const tzOffset =
      typeof req.body?.tz_offset_minutes === 'number' && Number.isFinite(req.body.tz_offset_minutes)
        ? req.body.tz_offset_minutes
        : null;

    if (startTime) {
      if (tzOffset !== null) {
        const [y, m, d] = sessionDate.split('-').map(Number);
        const [hh, mm] = startTime.split(':').map(Number);
        startedAt = new Date(Date.UTC(y, m - 1, d, hh, mm, 0) + tzOffset * 60 * 1000);
      } else {
        startedAt = new Date(`${sessionDate}T${startTime}:00`);
      }
      endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
    } else {
      const now = new Date();
      const todayKey =
        tzOffset !== null
          ? new Date(now.getTime() - tzOffset * 60 * 1000).toISOString().slice(0, 10)
          : now.toISOString().slice(0, 10);
      if (sessionDate === todayKey) {
        endedAt = now;
        startedAt = new Date(now.getTime() - durationSeconds * 1000);
      } else if (tzOffset !== null) {
        const [y, m, d] = sessionDate.split('-').map(Number);
        startedAt = new Date(Date.UTC(y, m - 1, d, 9, 0, 0) + tzOffset * 60 * 1000);
        endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
      } else {
        startedAt = new Date(`${sessionDate}T09:00:00`);
        endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertRes = await client.query(
        `INSERT INTO focus_sessions (
           user_id, board_id, project_id, task_id, subtask_id,
           task_title, subtask_title, project_name, board_name, board_color,
           mode, duration_seconds, started_at, ended_at, session_date
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, user_id, board_id, project_id, task_id, subtask_id,
                   task_title, subtask_title, project_name, board_name, board_color,
                   mode, duration_seconds, started_at, ended_at, session_date`,
        [
          req.user.id,
          meta.board_id,
          meta.project_id,
          meta.task_id,
          meta.subtask_id,
          meta.task_title || 'Focus Session',
          meta.subtask_title || null,
          meta.project_name || '',
          meta.board_name || '',
          meta.board_color || '#FFFFFF',
          mode,
          durationSeconds,
          startedAt,
          endedAt,
          sessionDate,
        ]
      );

      if (subtaskId) {
        await client.query(
          'UPDATE subtasks SET time_spent_seconds = time_spent_seconds + $1 WHERE id = $2 AND user_id = $3',
          [durationSeconds, subtaskId, req.user.id]
        );
      } else {
        await client.query(
          'UPDATE tasks SET time_spent_seconds = time_spent_seconds + $1 WHERE id = $2 AND user_id = $3',
          [durationSeconds, taskId, req.user.id]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json(insertRes.rows[0]);
    } catch (innerErr) {
      await client.query('ROLLBACK');
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create focus session error:', err);
    return res.status(500).json({ error: 'Failed to log focus session' });
  }
});

app.delete('/api/focus-sessions/:id', authMiddleware, async (req, res) => {
  try {
    return await deleteOwnedItem('focus_sessions', req, res);
  } catch (err) {
    console.error('Delete focus session error:', err);
    return res.status(500).json({ error: 'Failed to delete focus session' });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`kanso backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
