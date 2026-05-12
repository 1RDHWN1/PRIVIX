const { ROLE_PRIORITY } = require("../lib/constants")
const { normalizeText } = require("../lib/validation")
const { dbRun, dbGet, dbAll } = require("../lib/db")

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

async function getServerMembers(serverId) {
  const rows = await dbAll(
    `
    SELECT
      sm.id AS member_id,
      u.username,
      COALESCE(r.name, 'member') AS role_name,
      sm.joined_at,
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

module.exports = {
  ensureMemberRoleId,
  getServerMembers,
  getMemberMuteState,
  getRoleIdByName,
  isServerMember,
  getMemberRoleInfo
}
