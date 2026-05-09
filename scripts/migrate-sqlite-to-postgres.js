const path = require("path")
const sqlite3 = require("sqlite3").verbose()
const { Pool } = require("pg")

const sqlitePath =
  process.env.PRIVIX_SQLITE_PATH ||
  process.env.PRIVIX_DB_PATH ||
  path.join(__dirname, "..", "privix.db")

const pgConnectionString = process.env.DATABASE_URL || process.env.PRIVIX_DATABASE_URL
if (!pgConnectionString && !process.env.PGDATABASE) {
  console.error("Set DATABASE_URL atau PGHOST/PGDATABASE/PGUSER/PGPASSWORD dulu.")
  process.exit(1)
}

if (!process.env.PRIVIX_DB_CLIENT) {
  process.env.PRIVIX_DB_CLIENT = "postgres"
}

const { db, initDatabase } = require("../server/lib/db")

const sqlite = new sqlite3.Database(sqlitePath)
const pg = new Pool({
  connectionString: pgConnectionString,
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

const userIdMap = new Map()

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite.all(sql, params, (error, rows) => {
      if (error) {
        reject(error)
        return
      }
      resolve(rows || [])
    })
  })
}

async function sqliteTableColumns(tableName) {
  const rows = await sqliteAll(`PRAGMA table_info(${tableName})`)
  return new Set(rows.map((row) => row.name))
}

function closeSqlite() {
  return new Promise((resolve, reject) => {
    sqlite.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function buildPlaceholders(columnCount) {
  return Array.from({ length: columnCount }, (_, index) => `$${index + 1}`).join(", ")
}

function normalizeUsernameKey(row) {
  return String(row.username_key || row.username || "").trim().toLowerCase()
}

function mapUserId(value) {
  if (value == null) return value
  return userIdMap.get(Number(value)) || value
}

async function copyUsers(client) {
  const tableName = "users"
  const columns = ["id", "username", "username_key", "auth_token_hash", "created_at"]
  const existingColumns = await sqliteTableColumns(tableName)
  if (existingColumns.size === 0) {
    console.log("users: skip, tabel tidak ada di SQLite")
    return
  }

  const selectableColumns = columns.filter((column) => existingColumns.has(column))
  const rows = await sqliteAll(`SELECT ${selectableColumns.join(", ")} FROM users ORDER BY id ASC`)
  const keepByUsernameKey = new Map()
  const cleanRows = []

  for (const row of rows) {
    const usernameKey = normalizeUsernameKey(row)
    if (!usernameKey) {
      cleanRows.push(row)
      continue
    }

    const existing = keepByUsernameKey.get(usernameKey)
    if (existing) {
      userIdMap.set(Number(row.id), Number(existing.id))
      if (!existing.auth_token_hash && row.auth_token_hash) {
        existing.auth_token_hash = row.auth_token_hash
      }
      continue
    }

    row.username_key = usernameKey
    keepByUsernameKey.set(usernameKey, row)
    cleanRows.push(row)
  }

  const sql = `
    INSERT INTO users (${columns.join(", ")})
    VALUES (${buildPlaceholders(columns.length)})
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      username_key = EXCLUDED.username_key,
      auth_token_hash = EXCLUDED.auth_token_hash,
      created_at = EXCLUDED.created_at
  `

  for (const row of cleanRows) {
    await client.query(
      sql,
      columns.map((column) => {
        if (column === "username_key") return normalizeUsernameKey(row) || null
        return row[column]
      })
    )
  }

  await resetIdentity(client, tableName)
  console.log(`users: ${cleanRows.length} row${rows.length !== cleanRows.length ? `, ${rows.length - cleanRows.length} duplikat digabung` : ""}`)
}

function mapForeignKeyValue(column, value) {
  if (["owner_user_id", "user_id", "created_by_user_id", "actor_user_id", "muted_by_user_id"].includes(column)) {
    return mapUserId(value)
  }
  return value
}

async function resetIdentity(client, tableName) {
  await client.query(
    `
    SELECT setval(
      pg_get_serial_sequence($1, 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${tableName}), 1),
      true
    )
    `,
    [tableName]
  )
}

async function copyTable(client, tableName, columns, conflictColumns = ["id"]) {
  const existingColumns = await sqliteTableColumns(tableName)
  if (existingColumns.size === 0) {
    console.log(`${tableName}: skip, tabel tidak ada di SQLite`)
    return
  }

  const selectableColumns = columns.filter((column) => existingColumns.has(column))
  if (!selectableColumns.includes("id")) {
    console.log(`${tableName}: skip, kolom id tidak ada di SQLite`)
    return
  }

  const rows = await sqliteAll(`SELECT ${selectableColumns.join(", ")} FROM ${tableName} ORDER BY id ASC`)
  if (rows.length === 0) {
    console.log(`${tableName}: 0 row`)
    return
  }

  const conflictTarget = conflictColumns.join(", ")
  const updateColumns = columns.filter((column) => !conflictColumns.includes(column) && column !== "id")
  const updateSql =
    updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`
      : "DO NOTHING"
  const sql = `
    INSERT INTO ${tableName} (${columns.join(", ")})
    VALUES (${buildPlaceholders(columns.length)})
    ON CONFLICT (${conflictTarget}) ${updateSql}
  `

  for (const row of rows) {
    const values = columns.map((column) => {
      if (column === "username_key" && !row[column] && row.username) {
        return String(row.username).trim().toLowerCase()
      }
      if (column === "used_count" && row[column] == null) {
        return 0
      }
      return mapForeignKeyValue(column, row[column])
    })
    await client.query(sql, values)
  }

  await resetIdentity(client, tableName)
  console.log(`${tableName}: ${rows.length} row`)
}

async function main() {
  await initDatabase()
  const client = await pg.connect()
  try {
    await client.query("BEGIN")
    await copyUsers(client)
    await copyTable(client, "messages", ["id", "username", "channel", "message", "created_at"])
    await copyTable(client, "servers", ["id", "name", "owner_user_id", "created_at"])
    await copyTable(client, "roles", ["id", "server_id", "name", "priority", "created_at"])
    await copyTable(client, "server_members", [
      "id",
      "server_id",
      "user_id",
      "role_id",
      "muted_until_ts",
      "mute_reason",
      "muted_by_user_id",
      "joined_at"
    ], ["server_id", "user_id"])
    await copyTable(client, "channels", ["id", "server_id", "name", "type", "created_at"])
    await copyTable(client, "invites", [
      "id",
      "server_id",
      "code",
      "created_by_user_id",
      "max_uses",
      "used_count",
      "expires_at",
      "created_at"
    ])
    await copyTable(client, "channel_permissions", ["id", "channel_id", "role_name", "can_view", "can_send"])
    await copyTable(client, "audit_logs", ["id", "server_id", "actor_user_id", "action_type", "details", "created_at"])
    await client.query("COMMIT")
    console.log("Migrasi SQLite -> PostgreSQL selesai.")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("Migrasi gagal:", error)
    process.exitCode = 1
  } finally {
    client.release()
    await pg.end()
    await new Promise((resolve) => db.close(resolve))
    await closeSqlite()
  }
}

main()
