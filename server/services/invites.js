const { dbRun, dbGet } = require("../lib/db")

function generateInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
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

module.exports = {
  ensureInviteForServer
}
