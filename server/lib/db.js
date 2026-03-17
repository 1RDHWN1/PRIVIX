const sqlite3 = require("sqlite3").verbose()

const db = new sqlite3.Database("./privix.db")

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err)
        return
      }
      resolve(this)
    })
  })
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err)
        return
      }
      resolve(row)
    })
  })
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      resolve(rows || [])
    })
  })
}

function initDatabase() {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON")

    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        channel TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        owner_user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)

    db.run(`
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

    db.run(`
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
    db.run("ALTER TABLE server_members ADD COLUMN muted_until_ts INTEGER", (err) => {
      if (err && !String(err.message || "").includes("duplicate column name")) {
        console.error("add muted_until_ts column error:", err)
      }
    })
    db.run("ALTER TABLE server_members ADD COLUMN mute_reason TEXT", (err) => {
      if (err && !String(err.message || "").includes("duplicate column name")) {
        console.error("add mute_reason column error:", err)
      }
    })
    db.run("ALTER TABLE server_members ADD COLUMN muted_by_user_id INTEGER", (err) => {
      if (err && !String(err.message || "").includes("duplicate column name")) {
        console.error("add muted_by_user_id column error:", err)
      }
    })

    db.run(`
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

    db.run(`
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

    db.run(`
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

    db.run(`
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

    db.run(`
      INSERT OR IGNORE INTO roles (server_id, name, priority)
      SELECT id, 'moderator', 50 FROM servers
    `)
    db.run(`
      UPDATE roles
      SET priority = CASE name
        WHEN 'admin' THEN 100
        WHEN 'moderator' THEN 50
        WHEN 'member' THEN 1
        ELSE priority
      END
      WHERE name IN ('admin', 'moderator', 'member')
    `)

    db.run("CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel, id)")
    db.run("CREATE INDEX IF NOT EXISTS idx_server_members_server_user ON server_members(server_id, user_id)")
    db.run("CREATE INDEX IF NOT EXISTS idx_channels_server_name ON channels(server_id, name)")
    db.run("CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)")
    db.run("CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_role ON channel_permissions(channel_id, role_name)")
    db.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_server_id ON audit_logs(server_id, id)")
  })
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDatabase
}
