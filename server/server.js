const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const path = require("path")
const sqlite3 = require("sqlite3").verbose()

const db = new sqlite3.Database("./privix.db")
const MAX_USERNAME_LENGTH = 32
const MAX_CHANNEL_LENGTH = 32
const MAX_MESSAGE_LENGTH = 2000
const MAX_SERVER_NAME_LENGTH = 60
const CHANNEL_NAME_PATTERN = /^[a-z0-9-]+$/
const ROLE_PRIORITY = {
  admin: 100,
  moderator: 50,
  member: 1
}
const ROLE_PERMISSIONS = {
  admin: [
    "server.members.list",
    "audit.list",
    "member.role.set",
    "member.mute",
    "member.kick",
    "server.rename",
    "server.owner.transfer",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.view",
    "channel.permission.set",
    "invite.get",
    "invite.regenerate"
  ],
  moderator: [
    "server.members.list",
    "audit.list",
    "member.mute",
    "member.kick",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.view",
    "channel.permission.set",
    "invite.get"
  ],
  member: [
    "server.members.list",
    "audit.list",
    "channel.permission.view",
    "invite.get"
  ]
}
const PERMISSION_LABELS = {
  "server.members.list": "melihat daftar member server",
  "audit.list": "melihat audit log",
  "member.role.set": "mengubah role member",
  "member.mute": "mute member",
  "member.kick": "mengeluarkan member",
  "server.rename": "rename server",
  "server.owner.transfer": "transfer owner server",
  "channel.create": "membuat channel",
  "channel.rename": "rename channel",
  "channel.delete": "menghapus channel",
  "channel.permission.view": "melihat permission channel",
  "channel.permission.set": "mengubah permission channel",
  "invite.get": "mengambil invite code",
  "invite.regenerate": "regenerate invite code"
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidLength(value, maxLength) {
  return value.length > 0 && value.length <= maxLength
}

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

function buildRoomKey(serverId, channelName) {
  return `s:${serverId}:c:${channelName}`
}

async function writeAuditLog(serverId, actorUserId, actionType, details = null) {
  const createdAt = new Date().toISOString()
  await dbRun(
    "INSERT INTO audit_logs (server_id, actor_user_id, action_type, details, created_at) VALUES (?, ?, ?, ?, ?)",
    [serverId, actorUserId, actionType, details ? JSON.stringify(details) : null, createdAt]
  )
}

function generateInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

async function ensureMemberRoleId(serverId) {
  let memberRole = await dbGet(
    "SELECT id FROM roles WHERE server_id = ? AND name = 'member' LIMIT 1",
    [serverId]
  )
  if (memberRole) return memberRole.id

  const created = await dbRun(
    "INSERT INTO roles (server_id, name, priority) VALUES (?, 'member', 1)",
    [serverId]
  )
  return created.lastID
}

function getRolePriority(roleName) {
  if (!roleName) return ROLE_PRIORITY.member
  return ROLE_PRIORITY[roleName] || ROLE_PRIORITY.member
}

function hasServerPermission(roleName, permissionKey) {
  const normalizedRole = normalizeText(roleName).toLowerCase() || "member"
  const permissions = ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.member
  return permissions.includes(permissionKey)
}

function getPermissionDeniedError(permissionKey) {
  const actionLabel = PERMISSION_LABELS[permissionKey] || "melakukan aksi ini"
  return `Kamu tidak punya izin untuk ${actionLabel}`
}

async function requireServerPermission(userId, serverId, permissionKey) {
  const roleInfo = await getMemberRoleInfo(userId, serverId)
  if (!roleInfo) {
    return { ok: false, error: "Kamu bukan member server ini" }
  }
  if (!hasServerPermission(roleInfo.roleName, permissionKey)) {
    return { ok: false, error: getPermissionDeniedError(permissionKey), roleInfo }
  }
  return { ok: true, roleInfo }
}

async function requireServerOwner(userId, serverId) {
  const serverRow = await dbGet(
    "SELECT id, owner_user_id FROM servers WHERE id = ? LIMIT 1",
    [serverId]
  )
  if (!serverRow) {
    return { ok: false, error: "Server tidak ditemukan" }
  }
  if (Number(serverRow.owner_user_id) !== Number(userId)) {
    return { ok: false, error: "Hanya owner server yang bisa melakukan aksi ini" }
  }
  return { ok: true, server: serverRow }
}

async function ensureInviteForServer(serverId, createdByUserId) {
  const existing = await dbGet(
    "SELECT code FROM invites WHERE server_id = ? ORDER BY id ASC LIMIT 1",
    [serverId]
  )
  if (existing && existing.code) return existing.code

  let inviteCode = generateInviteCode()
  for (let i = 0; i < 6; i += 1) {
    try {
      await dbRun(
        "INSERT INTO invites (server_id, code, created_by_user_id) VALUES (?, ?, ?)",
        [serverId, inviteCode, createdByUserId]
      )
      return inviteCode
    } catch (error) {
      inviteCode = generateInviteCode()
    }
  }

  throw new Error("invite code generation failed")
}

async function ensureUser(username) {
  await dbRun("INSERT OR IGNORE INTO users (username) VALUES (?)", [username])
  const user = await dbGet("SELECT id, username FROM users WHERE username = ?", [username])
  return user
}

async function getMemberServers(userId) {
  return dbAll(
    `
    SELECT
      s.id,
      s.name,
      s.owner_user_id,
      s.created_at,
      COALESCE(r.name, 'member') AS current_role_name,
      COALESCE(r.priority, 0) AS current_role_priority
    FROM server_members sm
    JOIN servers s ON s.id = sm.server_id
    LEFT JOIN roles r ON r.id = sm.role_id
    WHERE sm.user_id = ?
    ORDER BY s.id ASC
    `,
    [userId]
  )
}

async function getServerChannels(serverId) {
  return dbAll(
    `
    SELECT id, name, type
    FROM channels
    WHERE server_id = ?
    ORDER BY CASE WHEN name = 'general' THEN 0 ELSE 1 END, name ASC
    `,
    [serverId]
  )
}

async function getServerMembers(serverId) {
  const rows = await dbAll(
    `
    SELECT
      sm.id AS member_id,
      u.username,
      COALESCE(r.name, 'member') AS role_name,
      sm.muted_until_ts,
      sm.mute_reason
    FROM server_members sm
    JOIN users u ON u.id = sm.user_id
    LEFT JOIN roles r ON r.id = sm.role_id
    WHERE sm.server_id = ?
    ORDER BY COALESCE(r.priority, 0) DESC, u.username ASC
    `,
    [serverId]
  )

  const now = Date.now()
  const staleMuteMemberIds = []
  for (const row of rows) {
    const mutedUntilTs = Number(row.muted_until_ts || 0)
    const isActiveMute = Number.isFinite(mutedUntilTs) && mutedUntilTs > now
    if (!isActiveMute && mutedUntilTs > 0) {
      staleMuteMemberIds.push(Number(row.member_id))
    }
    row.is_muted = isActiveMute ? 1 : 0
    if (!isActiveMute) {
      row.muted_until_ts = null
      row.mute_reason = null
    }
    delete row.member_id
  }

  for (const memberId of staleMuteMemberIds) {
    if (!Number.isInteger(memberId) || memberId <= 0) continue
    await dbRun(
      "UPDATE server_members SET muted_until_ts = NULL, mute_reason = NULL, muted_by_user_id = NULL WHERE id = ?",
      [memberId]
    )
  }

  return rows
}

async function getMemberMuteState(userId, serverId) {
  const row = await dbGet(
    "SELECT id, muted_until_ts, mute_reason FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
    [serverId, userId]
  )
  if (!row) {
    return { isMember: false, isMuted: false, mutedUntilTs: null, muteReason: "" }
  }

  const mutedUntilTs = Number(row.muted_until_ts || 0)
  if (!Number.isFinite(mutedUntilTs) || mutedUntilTs <= 0) {
    return { isMember: true, isMuted: false, mutedUntilTs: null, muteReason: "" }
  }

  const now = Date.now()
  if (mutedUntilTs <= now) {
    await dbRun(
      "UPDATE server_members SET muted_until_ts = NULL, mute_reason = NULL, muted_by_user_id = NULL WHERE id = ?",
      [row.id]
    )
    return { isMember: true, isMuted: false, mutedUntilTs: null, muteReason: "" }
  }

  return {
    isMember: true,
    isMuted: true,
    mutedUntilTs,
    muteReason: normalizeText(row.mute_reason)
  }
}

async function getRoleIdByName(serverId, roleName) {
  const role = await dbGet(
    "SELECT id FROM roles WHERE server_id = ? AND name = ? LIMIT 1",
    [serverId, roleName]
  )
  if (role && role.id) return role.id

  const priority = getRolePriority(roleName)
  const created = await dbRun(
    "INSERT INTO roles (server_id, name, priority) VALUES (?, ?, ?)",
    [serverId, roleName, priority]
  )
  return created.lastID
}

async function isServerMember(userId, serverId) {
  const membership = await dbGet(
    "SELECT id FROM server_members WHERE server_id = ? AND user_id = ?",
    [serverId, userId]
  )
  return Boolean(membership)
}

async function getMemberRoleInfo(userId, serverId) {
  const row = await dbGet(
    `
    SELECT COALESCE(r.name, 'member') AS role_name, COALESCE(r.priority, 0) AS priority
    FROM server_members sm
    LEFT JOIN roles r ON r.id = sm.role_id
    WHERE sm.server_id = ? AND sm.user_id = ?
    LIMIT 1
    `,
    [serverId, userId]
  )
  if (!row) return null
  return {
    roleName: String(row.role_name || "member").toLowerCase(),
    priority: Number(row.priority || 0)
  }
}

async function getChannelPermission(channelId, roleName) {
  return dbGet(
    `
    SELECT can_view, can_send
    FROM channel_permissions
    WHERE channel_id = ? AND role_name = ?
    LIMIT 1
    `,
    [channelId, roleName]
  )
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

initDatabase()

const app = express()
app.use(cors())
app.use(express.static(path.join(__dirname, "..", "client")))

const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: "*" }
})

io.on("connection", (socket) => {
  console.log("user connected")

  socket.data.username = ""
  socket.data.userId = null
  socket.data.roomKey = ""
  socket.data.activeServerId = null
  socket.data.activeChannel = ""
  socket.data.joinVersion = 0
  socket.data.isTyping = false

  function emitTypingIndicator(isTyping) {
    if (!socket.data.username || !socket.data.roomKey) return
    socket.to(socket.data.roomKey).emit("typing indicator", {
      username: socket.data.username,
      channel: socket.data.activeChannel,
      server_id: socket.data.activeServerId,
      is_typing: Boolean(isTyping)
    })
  }

  function clearTypingIndicator() {
    if (socket.data.isTyping) {
      emitTypingIndicator(false)
    }
    socket.data.isTyping = false
  }

  socket.on("set username", async (rawUsername, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const nextUsername = normalizeText(rawUsername)
      if (!isValidLength(nextUsername, MAX_USERNAME_LENGTH)) {
        reply({ ok: false, error: `Username wajib 1-${MAX_USERNAME_LENGTH} karakter` })
        return
      }

      const user = await ensureUser(nextUsername)
      socket.data.username = user.username
      socket.data.userId = user.id
      reply({ ok: true, username: user.username, user_id: user.id })
    } catch (error) {
      console.error("set username error:", error)
      reply({ ok: false, error: "Gagal set username" })
    }
  })

  socket.on("list servers", async (ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const servers = await getMemberServers(socket.data.userId)
      const withChannels = await Promise.all(
        servers.map(async (item) => {
          const channels = await getServerChannels(item.id)
          return { ...item, channels }
        })
      )

      reply({ ok: true, servers: withChannels })
    } catch (error) {
      console.error("list servers error:", error)
      reply({ ok: false, error: "Gagal memuat server" })
    }
  })

  socket.on("list server members", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "server.members.list"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const members = await getServerMembers(serverId)
      reply({ ok: true, members })
    } catch (error) {
      console.error("list server members error:", error)
      reply({ ok: false, error: "Gagal memuat member server" })
    }
  })

  socket.on("list audit logs", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "audit.list"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const rows = await dbAll(
        `
        SELECT al.id, al.action_type, al.details, al.created_at, u.username AS actor_username
        FROM audit_logs al
        JOIN users u ON u.id = al.actor_user_id
        WHERE al.server_id = ?
        ORDER BY al.id DESC
        LIMIT 25
        `,
        [serverId]
      )
      reply({ ok: true, logs: rows })
    } catch (error) {
      console.error("list audit logs error:", error)
      reply({ ok: false, error: "Gagal memuat audit logs" })
    }
  })

  socket.on("set member role", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      const roleName = normalizeText(payload && payload.role).toLowerCase()

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }
      if (roleName !== "admin" && roleName !== "moderator" && roleName !== "member") {
        reply({ ok: false, error: "Role tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.role.set"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User tidak ditemukan" })
        return
      }

      const targetMember = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMember) {
        reply({ ok: false, error: "User bukan member server ini" })
        return
      }

      if (targetUser.id === socket.data.userId && roleName !== "admin") {
        reply({ ok: false, error: "Kamu tidak bisa menurunkan role diri sendiri" })
        return
      }

      const roleId = await getRoleIdByName(serverId, roleName)
      await dbRun(
        "UPDATE server_members SET role_id = ? WHERE id = ?",
        [roleId, targetMember.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_role_changed", {
        target_username: targetUser.username,
        role: roleName
      })

      reply({ ok: true, username: targetUser.username, role: roleName })
    } catch (error) {
      console.error("set member role error:", error)
      reply({ ok: false, error: "Gagal update role member" })
    }
  })

  socket.on("kick member", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.kick"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, name, owner_user_id FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }

      if (Number(targetUser.id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Kamu tidak bisa kick diri sendiri" })
        return
      }

      if (Number(targetUser.id) === Number(serverRow.owner_user_id)) {
        reply({ ok: false, error: "Owner server tidak bisa di-kick" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const requesterRoleInfo = permissionCheck.roleInfo
      const targetRoleInfo = await getMemberRoleInfo(targetUser.id, serverId)
      if (!requesterRoleInfo || !targetRoleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (requesterRoleInfo.priority <= targetRoleInfo.priority) {
        reply({ ok: false, error: "Kamu hanya bisa kick member dengan role di bawahmu" })
        return
      }

      await dbRun(
        "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
        [serverId, targetUser.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_kicked", {
        target_username: targetUser.username
      })

      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (Number(s.data.userId) !== Number(targetUser.id)) continue
        if (Number(s.data.activeServerId) === serverId) {
          if (s.data.roomKey) {
            s.leave(s.data.roomKey)
          }
          s.data.roomKey = ""
          s.data.activeServerId = null
          s.data.activeChannel = ""
          s.data.joinVersion = Number(s.data.joinVersion || 0) + 1
        }
        s.emit("removed from server", {
          server_id: serverId,
          server_name: serverRow.name,
          reason: "kicked"
        })
      }

      reply({
        ok: true,
        server_id: serverId,
        target_username: targetUser.username
      })
    } catch (error) {
      console.error("kick member error:", error)
      reply({ ok: false, error: "Gagal kick member" })
    }
  })

  socket.on("mute member", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      const durationMinutes = Number(payload && payload.duration_minutes)
      const reason = normalizeText(payload && payload.reason)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
        reply({ ok: false, error: "Durasi mute harus 1-10080 menit" })
        return
      }
      if (reason.length > 200) {
        reply({ ok: false, error: "Alasan mute maksimal 200 karakter" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.mute"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, name, owner_user_id FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }

      if (Number(targetUser.id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Kamu tidak bisa mute diri sendiri" })
        return
      }

      if (Number(targetUser.id) === Number(serverRow.owner_user_id)) {
        reply({ ok: false, error: "Owner server tidak bisa di-mute" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const requesterRoleInfo = permissionCheck.roleInfo
      const targetRoleInfo = await getMemberRoleInfo(targetUser.id, serverId)
      if (!requesterRoleInfo || !targetRoleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (requesterRoleInfo.priority <= targetRoleInfo.priority) {
        reply({ ok: false, error: "Kamu hanya bisa mute member dengan role di bawahmu" })
        return
      }

      const mutedUntilTs = Date.now() + durationMinutes * 60 * 1000
      await dbRun(
        `
        UPDATE server_members
        SET muted_until_ts = ?, mute_reason = ?, muted_by_user_id = ?
        WHERE server_id = ? AND user_id = ?
        `,
        [mutedUntilTs, reason || null, socket.data.userId, serverId, targetUser.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_muted", {
        target_username: targetUser.username,
        duration_minutes: durationMinutes,
        mute_reason: reason || null,
        muted_until_ts: mutedUntilTs
      })

      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (Number(s.data.userId) !== Number(targetUser.id)) continue
        s.emit("member mute state", {
          server_id: serverId,
          server_name: serverRow.name,
          is_muted: true,
          muted_until_ts: mutedUntilTs,
          mute_reason: reason || null
        })
      }

      reply({
        ok: true,
        server_id: serverId,
        target_username: targetUser.username,
        duration_minutes: durationMinutes,
        muted_until_ts: mutedUntilTs
      })
    } catch (error) {
      console.error("mute member error:", error)
      reply({ ok: false, error: "Gagal mute member" })
    }
  })

  socket.on("unmute member", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username target wajib diisi" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "member.mute"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, name, owner_user_id FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const requesterRoleInfo = permissionCheck.roleInfo
      const targetRoleInfo = await getMemberRoleInfo(targetUser.id, serverId)
      if (!requesterRoleInfo || !targetRoleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }
      if (requesterRoleInfo.priority <= targetRoleInfo.priority) {
        reply({ ok: false, error: "Kamu hanya bisa unmute member dengan role di bawahmu" })
        return
      }

      await dbRun(
        `
        UPDATE server_members
        SET muted_until_ts = NULL, mute_reason = NULL, muted_by_user_id = NULL
        WHERE server_id = ? AND user_id = ?
        `,
        [serverId, targetUser.id]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_unmuted", {
        target_username: targetUser.username
      })

      const sockets = await io.fetchSockets()
      for (const s of sockets) {
        if (Number(s.data.userId) !== Number(targetUser.id)) continue
        s.emit("member mute state", {
          server_id: serverId,
          server_name: serverRow.name,
          is_muted: false,
          muted_until_ts: null,
          mute_reason: null
        })
      }

      reply({
        ok: true,
        server_id: serverId,
        target_username: targetUser.username
      })
    } catch (error) {
      console.error("unmute member error:", error)
      reply({ ok: false, error: "Gagal unmute member" })
    }
  })

  socket.on("rename server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const serverName = normalizeText(payload && payload.name)

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(serverName, MAX_SERVER_NAME_LENGTH)) {
        reply({ ok: false, error: `Nama server wajib 1-${MAX_SERVER_NAME_LENGTH} karakter` })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "server.rename"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      await dbRun("UPDATE servers SET name = ? WHERE id = ?", [serverName, serverId])
      await writeAuditLog(serverId, socket.data.userId, "server_renamed", { server_name: serverName })

      reply({ ok: true, server_id: serverId, name: serverName })
    } catch (error) {
      console.error("rename server error:", error)
      reply({ ok: false, error: "Gagal rename server" })
    }
  })

  socket.on("transfer server owner", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const targetUsername = normalizeText(payload && payload.username)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!targetUsername) {
        reply({ ok: false, error: "Username owner baru wajib diisi" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "server.owner.transfer"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const ownerCheck = await requireServerOwner(socket.data.userId, serverId)
      if (!ownerCheck.ok) {
        reply({ ok: false, error: ownerCheck.error })
        return
      }

      const targetUser = await dbGet(
        "SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        [targetUsername]
      )
      if (!targetUser) {
        reply({ ok: false, error: "User target tidak ditemukan" })
        return
      }
      if (Number(targetUser.id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Owner baru harus user lain" })
        return
      }

      const targetMembership = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [serverId, targetUser.id]
      )
      if (!targetMembership) {
        reply({ ok: false, error: "User target bukan member server ini" })
        return
      }

      const adminRoleId = await getRoleIdByName(serverId, "admin")
      await dbRun("BEGIN TRANSACTION")
      await dbRun(
        "UPDATE servers SET owner_user_id = ? WHERE id = ?",
        [targetUser.id, serverId]
      )
      await dbRun(
        "UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?",
        [adminRoleId, serverId, targetUser.id]
      )
      await dbRun("COMMIT")

      await writeAuditLog(serverId, socket.data.userId, "server_owner_transferred", {
        from_username: socket.data.username,
        to_username: targetUser.username
      })

      reply({
        ok: true,
        server_id: serverId,
        new_owner_user_id: targetUser.id,
        new_owner_username: targetUser.username
      })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("transfer server owner error:", error)
      reply({ ok: false, error: "Gagal transfer owner server" })
    }
  })

  socket.on("leave server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const serverRow = await dbGet(
        "SELECT id, owner_user_id, name FROM servers WHERE id = ? LIMIT 1",
        [serverId]
      )
      if (!serverRow) {
        reply({ ok: false, error: "Server tidak ditemukan" })
        return
      }

      const memberRows = await dbAll(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ?",
        [serverId, socket.data.userId]
      )
      if (!memberRows || memberRows.length === 0) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      if (Number(serverRow.owner_user_id) === Number(socket.data.userId)) {
        reply({ ok: false, error: "Owner belum bisa leave server. Transfer owner dulu." })
        return
      }

      await dbRun(
        "DELETE FROM server_members WHERE server_id = ? AND user_id = ?",
        [serverId, socket.data.userId]
      )
      await writeAuditLog(serverId, socket.data.userId, "member_left_server", {
        username: socket.data.username
      })

      if (Number(socket.data.activeServerId) === serverId) {
        if (socket.data.roomKey) {
          clearTypingIndicator()
          socket.leave(socket.data.roomKey)
        }
        socket.data.roomKey = ""
        socket.data.activeServerId = null
        socket.data.activeChannel = ""
      }

      const remainingServers = await getMemberServers(socket.data.userId)
      const nextServerId = remainingServers.length > 0 ? remainingServers[0].id : null

      reply({ ok: true, left_server_id: serverId, next_server_id: nextServerId })
    } catch (error) {
      console.error("leave server error:", error)
      reply({ ok: false, error: "Gagal leave server" })
    }
  })

  socket.on("create server", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverName = normalizeText(payload && payload.name)
      if (!isValidLength(serverName, MAX_SERVER_NAME_LENGTH)) {
        reply({ ok: false, error: `Nama server wajib 1-${MAX_SERVER_NAME_LENGTH} karakter` })
        return
      }

      await dbRun("BEGIN TRANSACTION")

      const serverResult = await dbRun(
        "INSERT INTO servers (name, owner_user_id) VALUES (?, ?)",
        [serverName, socket.data.userId]
      )
      const serverId = serverResult.lastID

      const adminRole = await dbRun(
        "INSERT INTO roles (server_id, name, priority) VALUES (?, 'admin', 100)",
        [serverId]
      )

      await dbRun(
        "INSERT INTO roles (server_id, name, priority) VALUES (?, 'member', 1)",
        [serverId]
      )
      await dbRun(
        "INSERT INTO roles (server_id, name, priority) VALUES (?, 'moderator', 50)",
        [serverId]
      )

      await dbRun(
        "INSERT INTO server_members (server_id, user_id, role_id) VALUES (?, ?, ?)",
        [serverId, socket.data.userId, adminRole.lastID]
      )

      await dbRun(
        "INSERT INTO channels (server_id, name, type) VALUES (?, 'general', 'text')",
        [serverId]
      )

      let inviteCode = generateInviteCode()
      let inviteCreated = false
      for (let i = 0; i < 5 && !inviteCreated; i += 1) {
        try {
          await dbRun(
            "INSERT INTO invites (server_id, code, created_by_user_id) VALUES (?, ?, ?)",
            [serverId, inviteCode, socket.data.userId]
          )
          inviteCreated = true
        } catch (error) {
          inviteCode = generateInviteCode()
        }
      }

      if (!inviteCreated) {
        throw new Error("invite code generation failed")
      }

      await dbRun("COMMIT")
      reply({
        ok: true,
        server_id: serverId,
        server: {
          id: serverId,
          name: serverName,
          channels: [{ name: "general", type: "text" }]
        },
        invite_code: inviteCode
      })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("create server error:", error)
      reply({ ok: false, error: "Gagal membuat server" })
    }
  })

  socket.on("create channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.name).toLowerCase()
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: `Nama channel wajib 1-${MAX_CHANNEL_LENGTH} karakter` })
        return
      }
      if (!CHANNEL_NAME_PATTERN.test(channelName)) {
        reply({ ok: false, error: "Nama channel hanya boleh huruf kecil, angka, dan '-'" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.create"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      await dbRun(
        "INSERT INTO channels (server_id, name, type) VALUES (?, ?, 'text')",
        [serverId, channelName]
      )
      await writeAuditLog(serverId, socket.data.userId, "channel_created", {
        channel: channelName
      })
      reply({ ok: true, channel: { server_id: serverId, name: channelName, type: "text" } })
    } catch (error) {
      if (error && String(error.message || "").includes("UNIQUE")) {
        reply({ ok: false, error: "Channel sudah ada di server ini" })
        return
      }
      console.error("create channel error:", error)
      reply({ ok: false, error: "Gagal membuat channel" })
    }
  })

  socket.on("get channel permission", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      const roleName = normalizeText(payload && payload.role).toLowerCase() || "member"

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.permission.view"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const channelRow = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      const permission = await getChannelPermission(channelRow.id, roleName)
      reply({
        ok: true,
        role: roleName,
        can_view: permission ? Number(permission.can_view) === 1 : true,
        can_send: permission ? Number(permission.can_send) === 1 : true
      })
    } catch (error) {
      console.error("get channel permission error:", error)
      reply({ ok: false, error: "Gagal mengambil permission channel" })
    }
  })

  socket.on("set channel permission", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      const roleName = normalizeText(payload && payload.role).toLowerCase()
      const canView = payload && payload.can_view ? 1 : 0
      const canSend = payload && payload.can_send ? 1 : 0

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }
      if (roleName !== "member") {
        reply({ ok: false, error: "Saat ini hanya role member yang bisa diatur" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.permission.set"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const channelRow = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      await dbRun(
        `
        INSERT INTO channel_permissions (channel_id, role_name, can_view, can_send)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_id, role_name)
        DO UPDATE SET can_view = excluded.can_view, can_send = excluded.can_send
        `,
        [channelRow.id, roleName, canView, canSend]
      )
      await writeAuditLog(serverId, socket.data.userId, "channel_permission_updated", {
        channel: channelName,
        role: roleName,
        can_view: canView === 1,
        can_send: canSend === 1
      })

      reply({ ok: true, role: roleName, can_view: canView === 1, can_send: canSend === 1 })
    } catch (error) {
      console.error("set channel permission error:", error)
      reply({ ok: false, error: "Gagal menyimpan permission channel" })
    }
  })

  socket.on("get server invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "invite.get"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const code = await ensureInviteForServer(serverId, socket.data.userId)
      reply({ ok: true, code })
    } catch (error) {
      console.error("get server invite error:", error)
      reply({ ok: false, error: "Gagal mengambil invite code" })
    }
  })

  socket.on("regenerate server invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "invite.regenerate"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      await dbRun("DELETE FROM invites WHERE server_id = ?", [serverId])
      const code = await ensureInviteForServer(serverId, socket.data.userId)
      await writeAuditLog(serverId, socket.data.userId, "server_invite_regenerated", { code })

      reply({ ok: true, code })
    } catch (error) {
      console.error("regenerate server invite error:", error)
      reply({ ok: false, error: "Gagal regenerate invite code" })
    }
  })

  socket.on("join via invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const code = normalizeText(payload && payload.code).toUpperCase()
      if (!code) {
        reply({ ok: false, error: "Invite code tidak valid" })
        return
      }

      const invite = await dbGet(
        `
        SELECT id, server_id, code, max_uses, used_count, expires_at
        FROM invites
        WHERE code = ?
        LIMIT 1
        `,
        [code]
      )
      if (!invite) {
        reply({ ok: false, error: "Invite code tidak ditemukan" })
        return
      }

      if (invite.expires_at) {
        const now = Date.now()
        const expiresAt = new Date(invite.expires_at).getTime()
        if (!Number.isNaN(expiresAt) && expiresAt <= now) {
          reply({ ok: false, error: "Invite code sudah expired" })
          return
        }
      }
      if (invite.max_uses && invite.used_count >= invite.max_uses) {
        reply({ ok: false, error: "Invite code sudah mencapai batas pemakaian" })
        return
      }

      const serverRow = await dbGet("SELECT id FROM servers WHERE id = ? LIMIT 1", [invite.server_id])
      if (!serverRow) {
        reply({ ok: false, error: "Server pada invite tidak ditemukan" })
        return
      }

      const memberRoleId = await ensureMemberRoleId(invite.server_id)
      const existingMember = await dbGet(
        "SELECT id FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        [invite.server_id, socket.data.userId]
      )

      await dbRun("BEGIN TRANSACTION")
      if (!existingMember) {
        await dbRun(
          "INSERT INTO server_members (server_id, user_id, role_id) VALUES (?, ?, ?)",
          [invite.server_id, socket.data.userId, memberRoleId]
        )
        await dbRun(
          "UPDATE invites SET used_count = used_count + 1 WHERE id = ?",
          [invite.id]
        )
        await writeAuditLog(invite.server_id, socket.data.userId, "member_joined_via_invite", {
          code: invite.code
        })
      }
      await dbRun("COMMIT")

      await dbRun(
        "INSERT OR IGNORE INTO channels (server_id, name, type) VALUES (?, 'general', 'text')",
        [invite.server_id]
      )

      reply({ ok: true, server_id: invite.server_id })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("join via invite error:", error)
      reply({ ok: false, error: "Gagal join via invite" })
    }
  })

  socket.on("delete channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel).toLowerCase()
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }
      if (channelName === "general") {
        reply({ ok: false, error: "Channel #general tidak bisa dihapus" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.delete"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const channelRow = await dbGet(
        "SELECT id, name FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      const roomKey = buildRoomKey(serverId, channelName)
      await dbRun("BEGIN TRANSACTION")
      await dbRun("DELETE FROM messages WHERE channel = ?", [roomKey])
      await dbRun("DELETE FROM channels WHERE id = ?", [channelRow.id])
      await dbRun("COMMIT")
      await writeAuditLog(serverId, socket.data.userId, "channel_deleted", {
        channel: channelName
      })

      io.to(roomKey).emit("system error", { message: `Channel #${channelName} telah dihapus` })
      reply({ ok: true, deleted_channel: channelName })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("delete channel error:", error)
      reply({ ok: false, error: "Gagal menghapus channel" })
    }
  })

  socket.on("rename channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const oldChannel = normalizeText(payload && payload.old_channel).toLowerCase()
      const newChannel = normalizeText(payload && payload.new_channel).toLowerCase()

      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(oldChannel, MAX_CHANNEL_LENGTH) || !isValidLength(newChannel, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Nama channel tidak valid" })
        return
      }
      if (!CHANNEL_NAME_PATTERN.test(newChannel)) {
        reply({ ok: false, error: "Nama channel hanya boleh huruf kecil, angka, dan '-'" })
        return
      }
      if (oldChannel === "general") {
        reply({ ok: false, error: "Channel #general tidak bisa di-rename" })
        return
      }
      if (oldChannel === newChannel) {
        reply({ ok: false, error: "Nama channel baru harus berbeda" })
        return
      }

      const permissionCheck = await requireServerPermission(
        socket.data.userId,
        serverId,
        "channel.rename"
      )
      if (!permissionCheck.ok) {
        reply({ ok: false, error: permissionCheck.error })
        return
      }

      const oldChannelRow = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, oldChannel]
      )
      if (!oldChannelRow) {
        reply({ ok: false, error: "Channel lama tidak ditemukan" })
        return
      }

      const existingNew = await dbGet(
        "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, newChannel]
      )
      if (existingNew) {
        reply({ ok: false, error: "Nama channel baru sudah dipakai" })
        return
      }

      const oldRoomKey = buildRoomKey(serverId, oldChannel)
      const newRoomKey = buildRoomKey(serverId, newChannel)

      await dbRun("BEGIN TRANSACTION")
      await dbRun(
        "UPDATE channels SET name = ? WHERE id = ?",
        [newChannel, oldChannelRow.id]
      )
      await dbRun(
        "UPDATE messages SET channel = ? WHERE channel = ?",
        [newRoomKey, oldRoomKey]
      )
      await dbRun("COMMIT")
      await writeAuditLog(serverId, socket.data.userId, "channel_renamed", {
        old_channel: oldChannel,
        new_channel: newChannel
      })

      const roomSockets = await io.in(oldRoomKey).fetchSockets()
      for (const s of roomSockets) {
        s.leave(oldRoomKey)
        s.join(newRoomKey)
        if (Number(s.data.activeServerId) === serverId && s.data.activeChannel === oldChannel) {
          s.data.activeChannel = newChannel
          s.data.roomKey = newRoomKey
        }
      }

      io.to(newRoomKey).emit("channel renamed", {
        server_id: serverId,
        old_channel: oldChannel,
        new_channel: newChannel
      })

      reply({
        ok: true,
        server_id: serverId,
        old_channel: oldChannel,
        new_channel: newChannel
      })
    } catch (error) {
      await dbRun("ROLLBACK").catch(() => {})
      console.error("rename channel error:", error)
      reply({ ok: false, error: "Gagal rename channel" })
    }
  })

  socket.on("join server channel", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      if (!socket.data.userId || !socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }

      const serverId = Number(payload && payload.server_id)
      const channelName = normalizeText(payload && payload.channel)
      if (!Number.isInteger(serverId) || serverId <= 0) {
        reply({ ok: false, error: "Server tidak valid" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }

      const member = await isServerMember(socket.data.userId, serverId)
      if (!member) {
        reply({ ok: false, error: "Kamu bukan member server ini" })
        return
      }

      const channelRow = await dbGet(
        "SELECT id, name FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
        [serverId, channelName]
      )
      if (!channelRow) {
        reply({ ok: false, error: "Channel tidak ditemukan" })
        return
      }

      const roleInfo = await getMemberRoleInfo(socket.data.userId, serverId)
      if (!roleInfo) {
        reply({ ok: false, error: "Role member tidak ditemukan" })
        return
      }

      if (roleInfo.priority < 100) {
        const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
        if (permission && Number(permission.can_view) !== 1) {
          reply({ ok: false, error: "Kamu tidak punya akses melihat channel ini" })
          return
        }
      }

      const nextRoomKey = buildRoomKey(serverId, channelName)
      const previousRoom = socket.data.roomKey
      if (previousRoom) {
        clearTypingIndicator()
        socket.leave(previousRoom)
      }

      socket.join(nextRoomKey)
      socket.data.roomKey = nextRoomKey
      socket.data.activeServerId = serverId
      socket.data.activeChannel = channelName
      socket.data.joinVersion += 1
      const joinVersion = socket.data.joinVersion

      const rows = await dbAll(
        "SELECT username, message, created_at FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 20",
        [nextRoomKey]
      )

      if (socket.data.joinVersion !== joinVersion || socket.data.roomKey !== nextRoomKey) {
        reply({ ok: false, error: "Join channel dibatalkan" })
        return
      }

      reply({
        ok: true,
        server_id: serverId,
        channel: channelName,
        history: rows.reverse()
      })
    } catch (error) {
      console.error("join server channel error:", error)
      reply({ ok: false, error: "Gagal masuk channel" })
    }
  })

  // Backward compatibility: legacy global channel flow
  socket.on("join channel", async (channel, ack) => {
    const reply = typeof ack === "function" ? ack : () => {}
    try {
      const channelName = normalizeText(channel)
      if (!socket.data.username) {
        reply({ ok: false, error: "Set username dulu" })
        return
      }
      if (!isValidLength(channelName, MAX_CHANNEL_LENGTH)) {
        reply({ ok: false, error: "Channel tidak valid" })
        return
      }
      const roomKey = `legacy:${channelName}`
      if (socket.data.roomKey) {
        clearTypingIndicator()
        socket.leave(socket.data.roomKey)
      }
      socket.join(roomKey)
      socket.data.roomKey = roomKey
      socket.data.activeServerId = 0
      socket.data.activeChannel = channelName
      socket.data.joinVersion += 1
      const rows = await dbAll(
        "SELECT username, message, created_at FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 20",
        [roomKey]
      )
      reply({ ok: true, channel: channelName, history: rows.reverse() })
    } catch (error) {
      reply({ ok: false, error: "Gagal join channel" })
    }
  })

  socket.on("chat message", async (data) => {
    try {
      if (!data || typeof data.message !== "string") return
      const message = normalizeText(data.message)
      const username = socket.data.username
      const roomKey = socket.data.roomKey
      const serverId = Number(socket.data.activeServerId)
      const activeChannel = normalizeText(socket.data.activeChannel).toLowerCase()

      if (!username || !roomKey) return
      if (!isValidLength(message, MAX_MESSAGE_LENGTH)) {
        socket.emit("system error", { message: `Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter` })
        return
      }

      if (socket.data.isTyping) {
        clearTypingIndicator()
      }

      if (Number.isInteger(serverId) && serverId > 0 && activeChannel) {
        const roleInfo = await getMemberRoleInfo(socket.data.userId, serverId)
        if (!roleInfo) {
          socket.emit("system error", { message: "Role member tidak ditemukan" })
          return
        }

        const muteState = await getMemberMuteState(socket.data.userId, serverId)
        if (!muteState.isMember) {
          socket.emit("system error", { message: "Kamu bukan member server ini" })
          return
        }
        if (muteState.isMuted) {
          const remainingMs = Math.max(0, Number(muteState.mutedUntilTs || 0) - Date.now())
          const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000))
          const reasonText = muteState.muteReason ? ` Alasan: ${muteState.muteReason}` : ""
          socket.emit("system error", {
            message: `Kamu sedang di-mute (${remainingMinutes} menit lagi).${reasonText}`
          })
          return
        }

        if (roleInfo.priority < 100) {
          const channelRow = await dbGet(
            "SELECT id FROM channels WHERE server_id = ? AND name = ? LIMIT 1",
            [serverId, activeChannel]
          )
          if (!channelRow) {
            socket.emit("system error", { message: "Channel tidak ditemukan" })
            return
          }

          const permission = await getChannelPermission(channelRow.id, roleInfo.roleName)
          if (permission && Number(permission.can_send) !== 1) {
            socket.emit("system error", { message: "Kamu tidak punya izin mengirim pesan di channel ini" })
            return
          }
        }
      }

      const createdAt = new Date().toISOString()
      await dbRun(
        "INSERT INTO messages (username, channel, message, created_at) VALUES (?, ?, ?, ?)",
        [username, roomKey, message, createdAt]
      )

      io.to(roomKey).emit("chat message", {
        username,
        message,
        created_at: createdAt,
        channel: socket.data.activeChannel,
        server_id: socket.data.activeServerId
      })
    } catch (error) {
      console.error("chat message error:", error)
      socket.emit("system error", { message: "Gagal menyimpan pesan" })
    }
  })

  socket.on("typing state", (payload) => {
    try {
      if (!socket.data.username || !socket.data.roomKey) return
      const nextIsTyping = Boolean(payload && payload.is_typing)
      if (nextIsTyping === socket.data.isTyping) return

      socket.data.isTyping = nextIsTyping
      emitTypingIndicator(nextIsTyping)
    } catch (error) {
      console.error("typing state error:", error)
    }
  })

  socket.on("disconnect", () => {
    clearTypingIndicator()
    console.log("user disconnected")
  })
})

const PORT = Number(process.env.PORT) || 3000

server.listen(PORT, () => {
  console.log(`Privix server running on port ${PORT}`)
})

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sedang dipakai. Jalankan dengan port lain.`)
    return
  }
  console.error("Server error:", err)
})
