const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const path = require("path")
const {
  MAX_USERNAME_LENGTH,
  MAX_CHANNEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SERVER_NAME_LENGTH,
  CHANNEL_NAME_PATTERN
} = require("./lib/constants")
const { normalizeText, isValidLength } = require("./lib/validation")
const { dbRun, dbGet, dbAll, initDatabase } = require("./lib/db")
const { requireServerPermission, requireServerOwner } = require("./lib/permissions")
const { writeAuditLog } = require("./services/audit")
const { ensureInviteForServer } = require("./services/invites")
const { ensureUser } = require("./services/users")
const { getMemberServers, getServerChannels } = require("./services/servers")
const {
  getServerMembers,
  getMemberMuteState,
  getRoleIdByName,
  isServerMember,
  getMemberRoleInfo,
  ensureMemberRoleId
} = require("./services/members")
const { buildRoomKey, getChannelPermission } = require("./services/channels")

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
