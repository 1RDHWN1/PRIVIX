import { memberFilterInput, serverSelect } from "../dom.js"
import { state } from "../state.js"
import { renderMembers } from "./render.js"
import { updateVoiceChannelListUi } from "../ui.js"

function normalizeUsernameKey(value) {
  return String(value || "").trim().toLowerCase()
}

function getActiveServerId() {
  const serverId = Number(serverSelect && serverSelect.value)
  return Number.isInteger(serverId) && serverId > 0 ? serverId : 0
}

function getOnlineSetForServer(serverId) {
  if (!state.onlineUsersByServer || !(state.onlineUsersByServer instanceof Map)) {
    state.onlineUsersByServer = new Map()
  }
  return state.onlineUsersByServer.get(Number(serverId) || 0) || new Set()
}

function applyOnlineFlags(members, serverId) {
  const list = Array.isArray(members) ? members : []
  const onlineSet = getOnlineSetForServer(serverId)
  return list.map((item) => {
    const usernameKey = normalizeUsernameKey(item && item.username)
    return {
      ...item,
      is_online: usernameKey ? onlineSet.has(usernameKey) : false
    }
  })
}

function getFilteredMembers() {
  const query = String((memberFilterInput && memberFilterInput.value) || "")
    .trim()
    .toLowerCase()
  const source = Array.isArray(state.membersCache) ? [...state.membersCache] : []
  const sorted = source.sort((a, b) => {
    const onlineA = Boolean(a && a.is_online)
    const onlineB = Boolean(b && b.is_online)
    if (onlineA !== onlineB) {
      return onlineA ? -1 : 1
    }
    return String((a && a.username) || "").localeCompare(String((b && b.username) || ""))
  })

  if (!query) return sorted

  return sorted.filter((item) => {
    const usernameText = String((item && item.username) || "").toLowerCase()
    const roleText = String((item && item.role_name) || "member").toLowerCase()
    return usernameText.includes(query) || roleText.includes(query)
  })
}

function setMembers(members) {
  const activeServerId = getActiveServerId()
  state.membersCache = applyOnlineFlags(members, activeServerId)
  renderMembers(getFilteredMembers())
  updateVoiceChannelListUi()
}

function setOnlineUsersForServer(serverId, users) {
  const resolvedServerId = Number(serverId)
  if (!Number.isInteger(resolvedServerId) || resolvedServerId <= 0) return

  if (!state.onlineUsersByServer || !(state.onlineUsersByServer instanceof Map)) {
    state.onlineUsersByServer = new Map()
  }

  const nextSet = new Set()
  const list = Array.isArray(users) ? users : []
  list.forEach((entry) => {
    const key = normalizeUsernameKey(entry && entry.username)
    if (key) nextSet.add(key)
  })
  state.onlineUsersByServer.set(resolvedServerId, nextSet)

  if (getActiveServerId() !== resolvedServerId) return
  state.membersCache = applyOnlineFlags(state.membersCache, resolvedServerId)
  renderMembers(getFilteredMembers())
  updateVoiceChannelListUi()
}

function clearOnlineUsersForServer(serverId) {
  const resolvedServerId = Number(serverId)
  if (!Number.isInteger(resolvedServerId) || resolvedServerId <= 0) return

  if (!state.onlineUsersByServer || !(state.onlineUsersByServer instanceof Map)) {
    state.onlineUsersByServer = new Map()
  } else {
    state.onlineUsersByServer.delete(resolvedServerId)
  }

  if (getActiveServerId() !== resolvedServerId) return
  state.membersCache = applyOnlineFlags(state.membersCache, resolvedServerId)
  renderMembers(getFilteredMembers())
  updateVoiceChannelListUi()
}

function clearAllOnlineUsers() {
  state.onlineUsersByServer = new Map()
  const activeServerId = getActiveServerId()
  state.membersCache = applyOnlineFlags(state.membersCache, activeServerId)
  renderMembers(getFilteredMembers())
  updateVoiceChannelListUi()
}

export {
  getFilteredMembers,
  setMembers,
  setOnlineUsersForServer,
  clearOnlineUsersForServer,
  clearAllOnlineUsers
}
