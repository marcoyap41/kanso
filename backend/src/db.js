const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Initialize PostgreSQL schema and migrate auth/OAuth tables safely.
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(254),
      name VARCHAR(100),
      username VARCHAR(100) NOT NULL,
      password_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(100);
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
    DELETE FROM users WHERE email IS NULL OR username = 'zenuser';
    ALTER TABLE users ALTER COLUMN email SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

    CREATE TABLE IF NOT EXISTS pending_signups (
      email VARCHAR(254) PRIMARY KEY,
      name VARCHAR(100),
      password_hash TEXT NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      token_expires_at TIMESTAMPTZ NOT NULL,
      pending_expires_at TIMESTAMPTZ NOT NULL,
      last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      send_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(20) NOT NULL,
      provider_user_id VARCHAR(255) NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (provider, provider_user_id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

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
      scheduled_date VARCHAR(10),
      scheduled_time VARCHAR(5),
      scheduled_duration_minutes INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_date VARCHAR(10);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_time VARCHAR(5);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_duration_minutes INTEGER;
    ALTER TABLE tasks ALTER COLUMN scheduled_duration_minutes DROP NOT NULL;
    ALTER TABLE tasks ALTER COLUMN scheduled_duration_minutes DROP DEFAULT;

    CREATE TABLE IF NOT EXISTS subtasks (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id INTEGER REFERENCES task_boards(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      subtask_id INTEGER REFERENCES subtasks(id) ON DELETE SET NULL,
      task_title VARCHAR(200) NOT NULL DEFAULT 'Focus Session',
      subtask_title VARCHAR(200),
      project_name VARCHAR(160) DEFAULT '',
      board_name VARCHAR(120) DEFAULT '',
      board_color VARCHAR(32) NOT NULL DEFAULT '#FFFFFF',
      mode VARCHAR(20) NOT NULL DEFAULT 'pomodoro',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      session_date VARCHAR(10) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS focus_sessions_user_date_idx ON focus_sessions (user_id, session_date);
  `);
}

module.exports = {
  pool,
  initDb,
};
