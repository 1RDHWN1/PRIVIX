const { ROLE_PERMISSIONS, PERMISSION_LABELS } = require("./constants")
const { normalizeText } = require("./validation")
const { dbGet } = require("./db")
const { getMemberRoleInfo } = require("../services/members")

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

module.exports = {
  requireServerPermission,
  requireServerOwner
}
