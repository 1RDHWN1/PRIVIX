const path = require("path")
const sqlite3 = require("sqlite3").verbose()

const DB_CLIENT = String(process.env.PRIVIX_DB_CLIENT || (process.env.DATABASE_URL ? "postgres" : "sqlite"))
  .trim()
  .toLowerCase()
const isPostgres = DB_CLIENT === "postgres" || DB_CLIENT === "pg"

let sqliteDb = null
let pgPool = null
let pgTxClient = null

function createSqliteDb() {
  if (sqliteDb) return sqliteDb
  const dbPath = process.env.PRIVIX_DB_PATH || path.join(__dirname, "..", "..", "privix.db")
  sqliteDb = new sqlite3.Database(dbPath)
  return sqliteDb
}

function createPgPool() {
  if (pgPool) return pgPool
  const { Pool } = require("pg")
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.PRIVIX_DATABASE_URL,
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl:
      String(process.env.PGSSL || "").trim() === "1" ||
      String(process.env.PGSSLMODE || "").trim().toLowerCase() === "require"
        ? { rejectUnauthorized: false }
        : undefined
  })
  return pgPool
}

const db = {
  close(callback) {
    if (isPostgres) {
      const done = typeof callback === "function" ? callback : () => {}
      createPgPool()
        .end()
        .then(() => done())
        .catch(done)
      return
    }
    createSqliteDb().close(callback)
  }
}

function convertPlaceholders(sql) {
  let index = 0
  let inSingle = false
  let inDouble = false
  let result = ""

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const next = sql[i + 1]
    if (char === "'" && !inDouble) {
      result += char
      if (inSingle && next === "'") {
        result += next
        i += 1
      } else {
        inSingle = !inSingle
      }
      continue
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      result += char
      continue
    }
    if (char === "?" && !inSingle && !inDouble) {
      index += 1
      result += `$${index}`
      continue
    }
    result += char
  }

  return result
}

function appendPostgresReturning(sql) {
  const trimmed = sql.trim().replace(/;$/, "")
  if (!/^insert\s+into\s+/i.test(trimmed)) return trimmed
  if (/\breturning\b/i.test(trimmed)) return trimmed
  if (/^insert\s+into\s+schema_migrations\b/i.test(trimmed)) return trimmed
  return `${trimmed} RETURNING id`
}

function normalizePostgresSql(sql, { isRun = false } = {}) {
  let normalized = String(sql || "").trim()
  if (/^begin transaction$/i.test(normalized)) return "BEGIN"
  if (/^insert\s+or\s+ignore\s+into\s+/i.test(normalized)) {
    normalized = normalized.replace(/^insert\s+or\s+ignore\s+into\s+/i, "INSERT INTO ")
    normalized = normalized.replace(/;$/, "")
    if (!/\bon\s+conflict\b/i.test(normalized)) {
      normalized = `${normalized} ON CONFLICT DO NOTHING`
    }
  }
  normalized = convertPlaceholders(normalized)
  return isRun ? appendPostgresReturning(normalized) : normalized
}

function dbRun(sql, params = []) {
  if (isPostgres) {
    const pool = createPgPool()
    const query = normalizePostgresSql(sql, { isRun: true })
    if (/^begin$/i.test(query)) {
      if (pgTxClient) {
        return Promise.reject(new Error("Nested PostgreSQL transactions are not supported"))
      }
      return pool.connect().then((client) => {
        pgTxClient = client
        return client.query("BEGIN").then((result) => ({
          lastID: undefined,
          changes: result.rowCount,
          rowCount: result.rowCount,
          rows: result.rows || []
        }))
      })
    }

    if (/^commit$/i.test(query) || /^rollback$/i.test(query)) {
      const client = pgTxClient
      if (!client) {
        return Promise.resolve({ lastID: undefined, changes: 0, rowCount: 0, rows: [] })
      }
      return client.query(query).then((result) => {
        pgTxClient = null
        client.release()
        return {
          lastID: undefined,
          changes: result.rowCount,
          rowCount: result.rowCount,
          rows: result.rows || []
        }
      }).catch((error) => {
        pgTxClient = null
        client.release()
        throw error
      })
    }

    const runner = pgTxClient || pool
    return runner.query(query, params).then((result) => ({
      lastID: result.rows && result.rows[0] ? result.rows[0].id : undefined,
      changes: result.rowCount,
      rowCount: result.rowCount,
      rows: result.rows || []
    }))
  }

  const sqlite = createSqliteDb()
  return new Promise((resolve, reject) => {
    sqlite.run(sql, params, function onRun(err) {
      if (err) {
        reject(err)
        return
      }
      resolve(this)
    })
  })
}

function dbGet(sql, params = []) {
  if (isPostgres) {
    const pool = createPgPool()
    const runner = pgTxClient || pool
    return runner.query(normalizePostgresSql(sql), params).then((result) => result.rows[0])
  }

  const sqlite = createSqliteDb()
  return new Promise((resolve, reject) => {
    sqlite.get(sql, params, (err, row) => {
      if (err) {
        reject(err)
        return
      }
      resolve(row)
    })
  })
}

function dbAll(sql, params = []) {
  if (isPostgres) {
    const pool = createPgPool()
    const runner = pgTxClient || pool
    return runner.query(normalizePostgresSql(sql), params).then((result) => result.rows || [])
  }

  const sqlite = createSqliteDb()
  return new Promise((resolve, reject) => {
    sqlite.all(sql, params, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      resolve(rows || [])
    })
  })
}

function ignoreDuplicateColumn(error) {
  return error && (error.code === "42701" || String(error.message || "").includes("duplicate column name"))
}

async function addColumnIfMissing(tableName, columnSql) {
  try {
    await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`)
  } catch (error) {
    if (!ignoreDuplicateColumn(error)) {
      throw error
    }
  }
}

async function runSqliteMigrations() {
  await dbRun("PRAGMA foreign_keys = ON")
  await dbRun(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      channel TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await addColumnIfMissing("messages", "reply_to_message_id INTEGER")
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      username_key TEXT,
      auth_token_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await addColumnIfMissing("users", "username_key TEXT")
  await addColumnIfMissing("users", "auth_token_hash TEXT")
  await dbRun(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS server_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_id INTEGER,
      muted_until_ts INTEGER,
      mute_reason TEXT,
      muted_by_user_id INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, user_id),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
    )
  `)
  await addColumnIfMissing("server_members", "muted_until_ts INTEGER")
  await addColumnIfMissing("server_members", "mute_reason TEXT")
  await addColumnIfMissing("server_members", "muted_by_user_id INTEGER")
  await dbRun(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS channel_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      role_name TEXT NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_send INTEGER NOT NULL DEFAULT 1,
      UNIQUE(channel_id, role_name),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, username, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `)
}

async function runPostgresMigrations() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      username_key TEXT UNIQUE,
      auth_token_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      username TEXT,
      channel TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await dbRun(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS reply_to_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name)
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS server_members (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
      muted_until_ts BIGINT,
      mute_reason TEXT,
      muted_by_user_id INTEGER,
      joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, user_id)
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name)
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS channel_permissions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      role_name TEXT NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_send INTEGER NOT NULL DEFAULT 1,
      UNIQUE(channel_id, role_name)
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, username, emoji)
    )
  `)
  await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_key ON users(username_key)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel, id)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_server_members_server_user ON server_members(server_id, user_id)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_channels_server_name ON channels(server_id, name)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_role ON channel_permissions(channel_id, role_name)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_audit_logs_server_id ON audit_logs(server_id, id)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id)")
  await dbRun(
    "INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_postgres_schema') ON CONFLICT DO NOTHING"
  )
}

async function runCommonDataMigrations() {
  await dbRun("UPDATE users SET username_key = LOWER(TRIM(username)) WHERE username_key IS NULL OR username_key = ''")
  await dbRun(`
    INSERT OR IGNORE INTO roles (server_id, name, priority)
    SELECT id, 'moderator', 50 FROM servers
  `)
  await dbRun(`
    UPDATE roles
    SET priority = CASE name
      WHEN 'admin' THEN 100
      WHEN 'moderator' THEN 50
      WHEN 'member' THEN 1
      ELSE priority
    END
    WHERE name IN ('admin', 'moderator', 'member')
  `)
}

async function runSqliteIndexesAndCleanup() {
  await dbRun("DROP TABLE IF EXISTS temp.user_identity_merge")
  await dbRun(`
    CREATE TEMP TABLE user_identity_merge AS
    SELECT u.id AS old_id, keepers.keep_id AS keep_id
    FROM users u
    JOIN (
      SELECT LOWER(TRIM(username)) AS username_key, MIN(id) AS keep_id
      FROM users
      WHERE username IS NOT NULL AND TRIM(username) <> ''
      GROUP BY LOWER(TRIM(username))
      HAVING COUNT(*) > 1
    ) keepers ON LOWER(TRIM(u.username)) = keepers.username_key
    WHERE u.id <> keepers.keep_id
  `)
  await dbRun(`
    UPDATE users
    SET auth_token_hash = COALESCE(
      NULLIF(auth_token_hash, ''),
      (
        SELECT duplicate.auth_token_hash
        FROM users duplicate
        JOIN user_identity_merge merge ON merge.old_id = duplicate.id
        WHERE merge.keep_id = users.id
          AND duplicate.auth_token_hash IS NOT NULL
          AND duplicate.auth_token_hash <> ''
        LIMIT 1
      )
    )
    WHERE id IN (SELECT keep_id FROM user_identity_merge)
  `)
  await dbRun(`
    UPDATE servers
    SET owner_user_id = (
      SELECT keep_id FROM user_identity_merge WHERE old_id = servers.owner_user_id
    )
    WHERE owner_user_id IN (SELECT old_id FROM user_identity_merge)
  `)
  await dbRun(`
    UPDATE invites
    SET created_by_user_id = (
      SELECT keep_id FROM user_identity_merge WHERE old_id = invites.created_by_user_id
    )
    WHERE created_by_user_id IN (SELECT old_id FROM user_identity_merge)
  `)
  await dbRun(`
    UPDATE audit_logs
    SET actor_user_id = (
      SELECT keep_id FROM user_identity_merge WHERE old_id = audit_logs.actor_user_id
    )
    WHERE actor_user_id IN (SELECT old_id FROM user_identity_merge)
  `)
  await dbRun(`
    DELETE FROM server_members
    WHERE user_id IN (SELECT old_id FROM user_identity_merge)
      AND EXISTS (
        SELECT 1
        FROM user_identity_merge merge
        JOIN server_members canonical_member
          ON canonical_member.user_id = merge.keep_id
         AND canonical_member.server_id = server_members.server_id
        WHERE merge.old_id = server_members.user_id
      )
  `)
  await dbRun(`
    UPDATE server_members
    SET user_id = (
      SELECT keep_id FROM user_identity_merge WHERE old_id = server_members.user_id
    )
    WHERE user_id IN (SELECT old_id FROM user_identity_merge)
  `)
  await dbRun("DELETE FROM users WHERE id IN (SELECT old_id FROM user_identity_merge)")
  await dbRun("UPDATE users SET username_key = LOWER(TRIM(username)) WHERE username_key IS NULL OR username_key = ''")
  await dbRun("DROP TABLE IF EXISTS temp.user_identity_merge")
  await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_key ON users(username_key)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel, id)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_server_members_server_user ON server_members(server_id, user_id)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_channels_server_name ON channels(server_id, name)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_role ON channel_permissions(channel_id, role_name)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_audit_logs_server_id ON audit_logs(server_id, id)")
  await dbRun("CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id)")
}

async function initDatabase() {
  if (isPostgres) {
    await runPostgresMigrations()
    await runCommonDataMigrations()
    return
  }

  await runSqliteMigrations()
  await runSqliteIndexesAndCleanup()
  await runCommonDataMigrations()
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
  isPostgres
}
