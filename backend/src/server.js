require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { pool, initDb, seedUserStarterData } = require('./db');
const { authMiddleware, JWT_SECRET } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const MAX_BOARDS_PER_USER = 5;

app.use(cors());
app.use(express.json());

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
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
      `SELECT id, project_id, title, completed, time_spent_seconds, created_at
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
 * Shared update handler for tasks and subtasks (title, completed, time_spent_seconds delta).
 */
async function updateTimedItem(table, req, res) {
  const itemId = parseId(req.params.id);
  if (!itemId) return res.status(400).json({ error: 'Invalid ID' });

  const { title, completed, add_seconds } = req.body || {};
  const updates = [];
  const values = [];

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

  if (add_seconds !== undefined) {
    const delta = Math.floor(Number(add_seconds));
    if (!Number.isFinite(delta) || delta < 0) {
      return res.status(400).json({ error: 'add_seconds must be a non-negative integer' });
    }
    if (delta > 0) {
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

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (rawUsername.length < 2 || rawUsername.length > 100) {
    return res.status(400).json({ error: 'Username must be between 2 and 100 characters' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [rawUsername]
    );
    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insertUser = await client.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
      [rawUsername, passwordHash]
    );
    const user = insertUser.rows[0];

    await seedUserStarterData(user.id, client);
    await client.query('COMMIT');

    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Failed to register account' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!rawUsername || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, created_at FROM users WHERE LOWER(username) = LOWER($1)',
      [rawUsername]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const row = result.rows[0];
    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = { id: row.id, username: row.username, created_at: row.created_at };
    const token = signToken(user);
    return res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Failed to load user profile' });
  }
});

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

  if (!projectId) return res.status(400).json({ error: 'Valid project_id is required' });
  if (!title) return res.status(400).json({ error: 'Task title is required' });

  try {
    if (!(await ensureOwned('projects', projectId, req.user.id))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await pool.query(
      `INSERT INTO tasks (project_id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, project_id, title, completed, time_spent_seconds, created_at`,
      [projectId, req.user.id, title]
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
