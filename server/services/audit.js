const { dbRun } = require("../lib/db")

async function writeAuditLog(serverId, actorUserId, actionType, details = null) {
  const createdAt = new Date().toISOString()
  await dbRun(
    "INSERT INTO audit_logs (server_id, actor_user_id, action_type, details, created_at) VALUES (?, ?, ?, ?, ?)",
    [serverId, actorUserId, actionType, details ? JSON.stringify(details) : null, createdAt]
  )
}

module.exports = {
  writeAuditLog
}
