import { ROLE_PERMISSIONS } from "./constants.js"
import { state } from "./state.js"

function getServerRoleName(server) {
  return String((server && server.current_role_name) || "member").toLowerCase()
}

function hasServerPermission(permissionKey, server) {
  const roleName = getServerRoleName(server)
  const permissions = ROLE_PERMISSIONS[roleName] || ROLE_PERMISSIONS.member
  return permissions.includes(permissionKey)
}

function getRoleBadge(roleName) {
  const role = String(roleName || "").toLowerCase()
  if (role === "admin") return "admin"
  if (role === "moderator") return "moderator"
  return "member"
}

function canLeaveServer(server) {
  if (!server) return false
  if (!state.currentUserId) return true
  return Number(server.owner_user_id) !== Number(state.currentUserId)
}

function isServerOwner(server) {
  if (!server || !state.currentUserId) return false
  return Number(server.owner_user_id) === Number(state.currentUserId)
}

function buildConnectedStatus(server, channelName) {
  if (!server) return "Connected"
  const roleLabel = getRoleBadge(getServerRoleName(server))
  return `Connected • ${server.name} • #${channelName} • ${roleLabel}`
}

export {
  getServerRoleName,
  hasServerPermission,
  getRoleBadge,
  canLeaveServer,
  isServerOwner,
  buildConnectedStatus
}
