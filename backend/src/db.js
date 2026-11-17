const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Initialize PostgreSQL schema if tables do not yet exist.
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS task_boards (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      color VARCHAR(32) NOT NULL DEFAULT '#FFFFFF',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      description TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

/**
 * Seed the canonical starter hierarchy for a newly registered user:
 * Task Board: College -> Project: Metopen -> Task: Tugas 5.5 -> Subtasks
 */
async function seedUserStarterData(userId, client = pool) {
  const boardRes = await client.query(
    `INSERT INTO task_boards (user_id, name, color, position)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, 'College', '#38BDF8', 0]
  );
  const boardId = boardRes.rows[0].id;

  const projectRes = await client.query(
    `INSERT INTO projects (board_id, user_id, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [boardId, userId, 'Metopen', 'Research methodology coursework and proposal milestones']
  );
  const projectId = projectRes.rows[0].id;

  const taskRes = await client.query(
    `INSERT INTO tasks (project_id, user_id, title)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [projectId, userId, 'Tugas 5.5']
  );
  const taskId = taskRes.rows[0].id;

  const starterSubtasks = ['Read proposal', 'Write Checklist', 'Submit'];
  for (const title of starterSubtasks) {
    await client.query(
      `INSERT INTO subtasks (task_id, user_id, title)
       VALUES ($1, $2, $3)`,
      [taskId, userId, title]
    );
  }
}

module.exports = {
  pool,
  initDb,
  seedUserStarterData,
};
