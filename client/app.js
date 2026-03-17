const socket = io("http://localhost:3000")

let username = ""
let currentUserId = null
let isSessionReady = false
let sessionRequestId = 0
let serversCache = []
let membersCache = []
let auditLogsCache = []
let inviteShareUrl = ""
let pendingInviteCodeFromUrl = ""
let inviteAutoJoinAttempted = false
let typingStopTimer = null
let isTypingSent = false
const typingUsers = new Set()

const USERNAME_KEY = "privix_username"
const SERVER_KEY = "privix_server_id"
const CHANNEL_KEY = "privix_channel"
const MAX_MESSAGE_LENGTH = 2000
const CHANNEL_NAME_PATTERN = /^[a-z0-9-]+$/
const ROLE_PERMISSIONS = {
  admin: [
    "member.role.set",
    "member.mute",
    "member.kick",
    "server.rename",
    "server.owner.transfer",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.set",
    "invite.get",
    "invite.regenerate"
  ],
  moderator: [
    "member.mute",
    "member.kick",
    "channel.create",
    "channel.rename",
    "channel.delete",
    "channel.permission.set",
    "invite.get"
  ],
  member: ["invite.get"]
}

const msgInput = document.getElementById("msg")
const sendBtn = document.getElementById("send-btn")
const serverSelect = document.getElementById("server-select")
const serverNameInput = document.getElementById("server-name")
const createServerBtn = document.getElementById("create-server-btn")
const renameServerBtn = document.getElementById("rename-server-btn")
const leaveServerBtn = document.getElementById("leave-server-btn")
const ownerUsernameInput = document.getElementById("owner-username")
const transferOwnerBtn = document.getElementById("transfer-owner-btn")
const noServerHint = document.getElementById("no-server-hint")
const sectionChannels = document.getElementById("section-channels")
const sectionMembers = document.getElementById("section-members")
const sectionAudit = document.getElementById("section-audit")
const rowServerLeave = document.getElementById("row-server-leave")
const rowTransferOwner = document.getElementById("row-transfer-owner")
const rowInviteActions = document.getElementById("row-invite-actions")
const rowChannelCreate = document.getElementById("row-channel-create")
const rowChannelManage = document.getElementById("row-channel-manage")
const rowChannelPermView = document.getElementById("row-channel-perm-view")
const rowChannelPermSend = document.getElementById("row-channel-perm-send")
const rowMemberTarget = document.getElementById("row-member-target")
const rowMemberRoleMain = document.getElementById("row-member-role-main")
const rowMemberRoleDemote = document.getElementById("row-member-role-demote")
const rowMemberKick = document.getElementById("row-member-kick")
const rowMemberMuteConfig = document.getElementById("row-member-mute-config")
const rowMemberMute = document.getElementById("row-member-mute")
const inviteCodeInput = document.getElementById("invite-code")
const joinInviteBtn = document.getElementById("join-invite-btn")
const getInviteBtn = document.getElementById("get-invite-btn")
const regenInviteBtn = document.getElementById("regen-invite-btn")
const copyInviteBtn = document.getElementById("copy-invite-btn")
const invitePreview = document.getElementById("invite-preview")
const channelSelect = document.getElementById("channel")
const channelNameInput = document.getElementById("channel-name")
const createChannelBtn = document.getElementById("create-channel-btn")
const renameChannelBtn = document.getElementById("rename-channel-btn")
const deleteChannelBtn = document.getElementById("delete-channel-btn")
const permMemberView = document.getElementById("perm-member-view")
const permMemberSend = document.getElementById("perm-member-send")
const savePermBtn = document.getElementById("save-perm-btn")
const messages = document.getElementById("messages")
const typingIndicator = document.getElementById("typing-indicator")
const usernameInput = document.getElementById("username")
const connectionStatus = document.getElementById("connection-status")
const memberList = document.getElementById("member-list")
const auditList = document.getElementById("audit-list")
const auditFilterSelect = document.getElementById("audit-filter")
const auditSearchInput = document.getElementById("audit-search")
const memberFilterInput = document.getElementById("member-filter")
const memberUsernameInput = document.getElementById("member-username")
const muteDurationSelect = document.getElementById("mute-duration")
const muteReasonInput = document.getElementById("mute-reason")
const promoteBtn = document.getElementById("promote-btn")
const modBtn = document.getElementById("mod-btn")
const demoteBtn = document.getElementById("demote-btn")
const kickBtn = document.getElementById("kick-btn")
const muteBtn = document.getElementById("mute-btn")
const unmuteBtn = document.getElementById("unmute-btn")
const noticeBackdrop = document.getElementById("notice-backdrop")
const noticeCard = document.getElementById("notice-card")
const noticeTitle = document.getElementById("notice-title")
const noticeMessage = document.getElementById("notice-message")
const noticeAction = document.getElementById("notice-action")
const noticeOk = document.getElementById("notice-ok")
let noticeActionHandler = null
let noticeCloseHandler = null

username = localStorage.getItem(USERNAME_KEY) || ""
usernameInput.value = username
try {
  const inviteCode = new URLSearchParams(window.location.search).get("invite")
  if (inviteCode) {
    pendingInviteCodeFromUrl = String(inviteCode).trim().toUpperCase()
    inviteCodeInput.value = pendingInviteCodeFromUrl
  }
} catch {}

function setStatus(text, isReady = false) {
  connectionStatus.textContent = text
  connectionStatus.dataset.state = isReady ? "ready" : "pending"
}

function notify(message, type = "info", options = {}) {
  if (!noticeBackdrop || !noticeCard || !noticeMessage || !noticeTitle) return
  const wasOpen = noticeBackdrop.classList.contains("show")
  const previousCloseHandler = noticeCloseHandler
  if (wasOpen && typeof previousCloseHandler === "function") {
    previousCloseHandler()
  }

  const title =
    String(options && options.title) ||
    (type === "success" ? "Success" : type === "error" ? "Error" : "Info")
  noticeTitle.textContent = title
  noticeMessage.textContent = message
  noticeCard.className = `notice-card ${type}`
  if (noticeOk) {
    noticeOk.textContent = String((options && options.okLabel) || "OK")
  }

  const actionLabel = String(options && options.actionLabel ? options.actionLabel : "").trim()
  const onAction = options && typeof options.onAction === "function" ? options.onAction : null
  const onClose = options && typeof options.onClose === "function" ? options.onClose : null
  noticeActionHandler = onAction
  noticeCloseHandler = onClose
  if (noticeAction) {
    const showAction = Boolean(actionLabel && onAction)
    noticeAction.textContent = actionLabel
    noticeAction.classList.toggle("is-hidden", !showAction)
    noticeAction.disabled = !showAction
  }

  noticeBackdrop.classList.add("show")
  noticeBackdrop.setAttribute("aria-hidden", "false")
}

function closeNotice(invokeCloseHandler = true) {
  if (!noticeBackdrop) return
  const closeHandler = noticeCloseHandler
  noticeBackdrop.classList.remove("show")
  noticeBackdrop.setAttribute("aria-hidden", "true")
  noticeActionHandler = null
  noticeCloseHandler = null
  if (noticeOk) {
    noticeOk.textContent = "OK"
  }
  if (noticeAction) {
    noticeAction.classList.add("is-hidden")
    noticeAction.textContent = ""
    noticeAction.disabled = true
  }
  if (invokeCloseHandler && typeof closeHandler === "function") {
    closeHandler()
  }
}

function confirmNotice(message, options = {}) {
  return new Promise((resolve) => {
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      resolve(Boolean(result))
    }

    notify(message, String(options.type || "info"), {
      title: String(options.title || "Confirm"),
      okLabel: String(options.cancelLabel || "Cancel"),
      actionLabel: String(options.confirmLabel || "Confirm"),
      onAction: () => {
        settle(true)
      },
      onClose: () => {
        settle(false)
      }
    })
  })
}

function focusInviteInput() {
  try {
    inviteCodeInput.scrollIntoView({ behavior: "smooth", block: "center" })
  } catch {}
  inviteCodeInput.focus()
  inviteCodeInput.select()
}

function notifyRemovedFromServer(serverName) {
  const safeServerName = String(serverName || "server")
  notify(`Kamu dikeluarkan dari server "${safeServerName}"`, "error", {
    title: "Removed From Server",
    actionLabel: "Join Another Server",
    onAction: () => {
      focusInviteInput()
      setStatus("Belum join server • masuk pakai invite code", false)
    }
  })
}

function renderTypingIndicator() {
  if (!typingIndicator) return
  const names = [...typingUsers]
  if (names.length === 0) {
    typingIndicator.textContent = ""
    typingIndicator.classList.remove("show")
    return
  }

  let text = ""
  if (names.length === 1) {
    text = `${names[0]} is typing...`
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing...`
  } else {
    const othersCount = names.length - 2
    text = `${names[0]}, ${names[1]} and ${othersCount} others are typing...`
  }
  typingIndicator.textContent = text
  typingIndicator.classList.add("show")
}

function sendTypingState(isTyping) {
  const nextState = Boolean(isTyping)
  if (!socket.connected || !isSessionReady) {
    isTypingSent = false
    return
  }
  if (isTypingSent === nextState) return
  isTypingSent = nextState
  socket.emit("typing state", { is_typing: nextState })
}

function stopTypingStateTimer() {
  if (!typingStopTimer) return
  clearTimeout(typingStopTimer)
  typingStopTimer = null
}

function queueTypingStop() {
  stopTypingStateTimer()
  typingStopTimer = setTimeout(() => {
    sendTypingState(false)
  }, 1200)
}

function resetTypingState(options = {}) {
  const notifyServer = Boolean(options.notifyServer)
  stopTypingStateTimer()
  typingUsers.clear()
  renderTypingIndicator()
  if (notifyServer && socket.connected && isTypingSent) {
    socket.emit("typing state", { is_typing: false })
  }
  isTypingSent = false
}

function renderListWithTransition(container, renderFn) {
  if (!container || typeof renderFn !== "function") return
  if (container.__refreshTimer) {
    clearTimeout(container.__refreshTimer)
  }

  container.classList.add("is-refreshing")
  container.__refreshTimer = setTimeout(() => {
    const fragment = document.createDocumentFragment()
    renderFn(fragment)
    container.innerHTML = ""
    container.appendChild(fragment)
    requestAnimationFrame(() => {
      container.classList.remove("is-refreshing")
    })
  }, 85)
}

function getFilteredMembers() {
  const query = String((memberFilterInput && memberFilterInput.value) || "")
    .trim()
    .toLowerCase()
  if (!query) return [...membersCache]

  return membersCache.filter((item) => {
    const usernameText = String((item && item.username) || "").toLowerCase()
    const roleText = String((item && item.role_name) || "member").toLowerCase()
    return usernameText.includes(query) || roleText.includes(query)
  })
}

function setMembers(members) {
  membersCache = Array.isArray(members) ? members : []
  renderMembers(getFilteredMembers())
  updateChannelActionState()
}

function getMutedUntilTs(member) {
  const raw = Number(member && member.muted_until_ts)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

function isMemberMuted(member) {
  const mutedUntilTs = getMutedUntilTs(member)
  return mutedUntilTs > Date.now()
}

function formatMuteRemaining(mutedUntilTs) {
  const remainingMs = Math.max(0, Number(mutedUntilTs || 0) - Date.now())
  if (remainingMs <= 0) return "0m"
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000))
  if (remainingMinutes >= 60) {
    const hours = Math.ceil(remainingMinutes / 60)
    return `${hours}h`
  }
  return `${remainingMinutes}m`
}

function formatDurationLabel(totalMinutes) {
  const minutes = Number(totalMinutes || 0)
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m"
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours >= 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`
  }
  return `${minutes}m`
}

function refreshMuteButtonLabel() {
  if (!muteBtn) return
  const duration = resolveMuteDuration(10)
  muteBtn.textContent = `Apply Mute (${formatDurationLabel(duration)})`
}

function getCurrentUserMuteInfo() {
  const selfName = String(username || "").trim().toLowerCase()
  if (!selfName) return { isMuted: false, mutedUntilTs: 0, muteReason: "" }
  const selfMember = membersCache.find(
    (item) => String((item && item.username) || "").trim().toLowerCase() === selfName
  )
  if (!selfMember) return { isMuted: false, mutedUntilTs: 0, muteReason: "" }

  const mutedUntilTs = getMutedUntilTs(selfMember)
  if (mutedUntilTs <= Date.now()) {
    return { isMuted: false, mutedUntilTs: 0, muteReason: "" }
  }

  return {
    isMuted: true,
    mutedUntilTs,
    muteReason: String((selfMember && selfMember.mute_reason) || "").trim()
  }
}

function appendHighlightedText(container, text, query) {
  if (!container) return
  const value = String(text || "")
  const keyword = String(query || "").trim().toLowerCase()
  if (!keyword) {
    container.textContent = value
    return
  }

  const lower = value.toLowerCase()
  let cursor = 0
  while (cursor < value.length) {
    const hit = lower.indexOf(keyword, cursor)
    if (hit < 0) {
      container.appendChild(document.createTextNode(value.slice(cursor)))
      break
    }
    if (hit > cursor) {
      container.appendChild(document.createTextNode(value.slice(cursor, hit)))
    }
    const mark = document.createElement("mark")
    mark.textContent = value.slice(hit, hit + keyword.length)
    container.appendChild(mark)
    cursor = hit + keyword.length
  }
}

function renderNoServerEmptyState() {
  messages.innerHTML = ""
  const wrapper = document.createElement("div")
  wrapper.className = "messages-empty"

  const card = document.createElement("div")
  card.className = "messages-empty-card"

  const title = document.createElement("h3")
  title.className = "messages-empty-title"
  title.textContent = "Belum Ada Server Aktif"

  const subtitle = document.createElement("p")
  subtitle.className = "messages-empty-subtitle"
  subtitle.textContent = "Join server pakai invite code, atau buat server baru dari panel kiri."

  const action = document.createElement("button")
  action.type = "button"
  action.className = "messages-empty-btn"
  action.textContent = "Join via Invite"
  action.addEventListener("click", () => {
    focusInviteInput()
    setStatus("Belum join server • masuk pakai invite code", false)
  })

  card.appendChild(title)
  card.appendChild(subtitle)
  card.appendChild(action)
  wrapper.appendChild(card)
  messages.appendChild(wrapper)
}

function renderMembers(members) {
  const activeServer = getActiveServer()
  const canManageRoles = activeServer && hasServerPermission("member.role.set", activeServer)
  const canMuteMembers = activeServer && hasServerPermission("member.mute", activeServer)
  const canKickMembers = activeServer && hasServerPermission("member.kick", activeServer)
  const query = String((memberFilterInput && memberFilterInput.value) || "")
    .trim()
    .toLowerCase()

  renderListWithTransition(memberList, (fragment) => {
    if (!Array.isArray(members) || members.length === 0) {
      const empty = document.createElement("div")
      empty.className = "list-empty"
      empty.textContent = query ? "Tidak ada member yang cocok" : "-"
      fragment.appendChild(empty)
      return
    }

    members.forEach((item) => {
      const usernameText = String((item && item.username) || "")
      const role = String((item && item.role_name) || "member").toLowerCase()
      const roleText =
        role === "admin" ? "admin" : role === "moderator" ? "moderator" : "member"
      const mutedUntilTs = getMutedUntilTs(item)
      const isMuted = isMemberMuted(item)
      const muteReason = String((item && item.mute_reason) || "").trim()
      const isSelf =
        usernameText && username && usernameText.toLowerCase() === String(username).toLowerCase()

      const line = document.createElement("div")
      line.className = "list-row member-item"
      const main = document.createElement("div")
      main.className = "member-main"

      const name = document.createElement("span")
      name.className = "member-name"
      appendHighlightedText(name, usernameText, query)

      const roleTag = document.createElement("span")
      roleTag.className = "member-role"
      roleTag.dataset.role = roleText
      appendHighlightedText(roleTag, roleText, query)

      main.appendChild(name)
      main.appendChild(roleTag)
      if (isMuted) {
        const muteTag = document.createElement("span")
        muteTag.className = "member-role"
        muteTag.dataset.role = "muted"
        muteTag.textContent = `muted ${formatMuteRemaining(mutedUntilTs)}`
        if (muteReason) {
          muteTag.title = `Reason: ${muteReason}`
        }
        main.appendChild(muteTag)
      }
      line.appendChild(main)

      const actions = document.createElement("div")
      actions.className = "member-actions"
      const addAction = (label, extraClass, onClick) => {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = `member-action-btn ${extraClass || ""}`.trim()
        btn.textContent = label
        btn.addEventListener("click", (event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick()
        })
        actions.appendChild(btn)
      }

      if (!isSelf && canManageRoles && role !== "admin") {
        addAction("Admin", "", () => handleSetMemberRole("admin", usernameText))
      }
      if (!isSelf && canManageRoles && role === "member") {
        addAction("Mod", "", () => handleSetMemberRole("moderator", usernameText))
      }
      if (!isSelf && canManageRoles && role !== "member") {
        addAction("Member", "", () => handleSetMemberRole("member", usernameText))
      }
      if (!isSelf && canKickMembers) {
        addAction("Kick", "is-danger", () => handleKickMember(usernameText))
      }
      if (!isSelf && canMuteMembers && !isMuted) {
        addAction("Mute", "is-warn", () => handleMuteMember(usernameText, 10))
      }
      if (!isSelf && canMuteMembers && isMuted) {
        addAction("Unmute", "", () => handleUnmuteMember(usernameText))
      }
      if (actions.childElementCount > 0) {
        line.appendChild(actions)
      }

      line.tabIndex = 0
      line.setAttribute("role", "group")
      line.setAttribute("aria-label", `Member ${usernameText}`)
      const pickMember = () => {
        memberUsernameInput.value = usernameText
        memberUsernameInput.focus()
      }
      line.addEventListener("click", pickMember)
      line.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          pickMember()
        }
      })
      fragment.appendChild(line)
    })
  })
}

function buildInviteUrl(code) {
  if (!code) return ""
  const base = new URL(window.location.href)
  base.search = ""
  base.hash = ""
  return `${base.origin}${base.pathname}?invite=${encodeURIComponent(code)}`
}

function setInvitePreview(code) {
  inviteShareUrl = code ? buildInviteUrl(code) : ""
  invitePreview.textContent = inviteShareUrl ? `Invite: ${inviteShareUrl}` : ""
}

function extractInviteCode(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const plain = raw.toUpperCase()
  if (/^[A-Z0-9]{4,}$/.test(plain)) return plain

  try {
    const url = new URL(raw, window.location.origin)
    const queryCode = String(url.searchParams.get("invite") || "").trim().toUpperCase()
    if (queryCode) return queryCode

    const parts = url.pathname.split("/").filter(Boolean)
    const tail = parts.length > 0 ? String(parts[parts.length - 1]).trim().toUpperCase() : ""
    if (/^[A-Z0-9]{4,}$/.test(tail)) return tail
  } catch {}

  return plain
}

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
  if (!currentUserId) return true
  return Number(server.owner_user_id) !== Number(currentUserId)
}

function isServerOwner(server) {
  if (!server || !currentUserId) return false
  return Number(server.owner_user_id) === Number(currentUserId)
}

function buildConnectedStatus(server, channelName) {
  if (!server) return "Connected"
  const roleLabel = getRoleBadge(getServerRoleName(server))
  return `Connected • ${server.name} • #${channelName} • ${roleLabel}`
}

function setElementHidden(element, hidden) {
  if (!element) return
  const shouldHide = Boolean(hidden)
  element.classList.toggle("is-collapsed", shouldHide)
  element.setAttribute("aria-hidden", shouldHide ? "true" : "false")
}

function setSoftButtonHidden(button, hidden) {
  if (!button) return
  const shouldHide = Boolean(hidden)
  button.classList.toggle("is-soft-hidden", shouldHide)
  button.setAttribute("aria-hidden", shouldHide ? "true" : "false")
  if (shouldHide) {
    button.setAttribute("tabindex", "-1")
  } else {
    button.removeAttribute("tabindex")
  }
}

function renderAuditLogs(logs) {
  renderListWithTransition(auditList, (fragment) => {
    if (!Array.isArray(logs) || logs.length === 0) {
      const empty = document.createElement("div")
      empty.className = "list-empty"
      empty.textContent = "-"
      fragment.appendChild(empty)
      return
    }

    logs.forEach((row) => {
      const line = document.createElement("div")
      line.className = "list-row"
      const when = formatTime(row.created_at)
      const actor = row.actor_username || "unknown"
      let label = row.action_type || "action"
      try {
        if (row.details) {
          const d = JSON.parse(row.details)
          if (row.action_type === "channel_created" && d.channel) label = `create #${d.channel}`
          if (row.action_type === "channel_deleted" && d.channel) label = `delete #${d.channel}`
          if (row.action_type === "channel_renamed" && d.old_channel && d.new_channel) label = `rename #${d.old_channel} -> #${d.new_channel}`
          if (row.action_type === "member_role_changed" && d.target_username && d.role) label = `role ${d.target_username} -> ${d.role}`
          if (row.action_type === "channel_permission_updated" && d.channel) label = `perm #${d.channel}`
          if (row.action_type === "member_joined_via_invite") label = "join via invite"
          if (row.action_type === "server_renamed" && d.server_name) label = `rename server -> ${d.server_name}`
          if (row.action_type === "server_invite_regenerated") label = "regenerate invite"
          if (row.action_type === "server_owner_transferred" && d.to_username) label = `transfer owner -> ${d.to_username}`
          if (row.action_type === "member_left_server") label = "leave server"
          if (row.action_type === "member_kicked" && d.target_username) label = `kick ${d.target_username}`
          if (row.action_type === "member_muted" && d.target_username) {
            const duration = Number(d.duration_minutes || 0)
            const reasonText = d.mute_reason ? ` (${d.mute_reason})` : ""
            label = duration > 0 ? `mute ${d.target_username} ${duration}m${reasonText}` : `mute ${d.target_username}${reasonText}`
          }
          if (row.action_type === "member_unmuted" && d.target_username) label = `unmute ${d.target_username}`
        }
      } catch {}
      line.textContent = `${when ? `[${when}] ` : ""}${actor}: ${label}`
      fragment.appendChild(line)
    })
  })
}

function getAuditLogCategory(actionType) {
  const action = String(actionType || "").toLowerCase()
  if (action.startsWith("member_")) return "member"
  if (action.startsWith("channel_")) return "channel"
  if (action.startsWith("server_")) return "server"
  if (action.includes("invite")) return "invite"
  return "other"
}

function getFilteredAuditLogs() {
  const selectedCategory = String((auditFilterSelect && auditFilterSelect.value) || "all")
  const keyword = String((auditSearchInput && auditSearchInput.value) || "")
    .trim()
    .toLowerCase()

  return auditLogsCache.filter((row) => {
    if (selectedCategory !== "all" && getAuditLogCategory(row.action_type) !== selectedCategory) {
      return false
    }
    if (!keyword) return true

    const actor = String((row && row.actor_username) || "").toLowerCase()
    const action = String((row && row.action_type) || "").toLowerCase()
    const details = String((row && row.details) || "").toLowerCase()
    return actor.includes(keyword) || action.includes(keyword) || details.includes(keyword)
  })
}

function setAuditLogs(logs) {
  auditLogsCache = Array.isArray(logs) ? logs : []
  renderAuditLogs(getFilteredAuditLogs())
}

function clearListTransition(container) {
  if (!container) return
  if (container.__refreshTimer) {
    clearTimeout(container.__refreshTimer)
    container.__refreshTimer = null
  }
  container.classList.remove("is-refreshing")
}

function clearRolePanels() {
  clearListTransition(memberList)
  clearListTransition(auditList)
  membersCache = []
  auditLogsCache = []
  if (memberFilterInput) {
    memberFilterInput.value = ""
  }
  if (auditFilterSelect) {
    auditFilterSelect.value = "all"
  }
  if (auditSearchInput) {
    auditSearchInput.value = ""
  }
  if (muteDurationSelect) {
    muteDurationSelect.value = "10"
  }
  if (muteReasonInput) {
    muteReasonInput.value = ""
  }
  refreshMuteButtonLabel()
  memberList.innerHTML = ""
  auditList.innerHTML = ""
  const memberEmpty = document.createElement("div")
  memberEmpty.className = "list-empty"
  memberEmpty.textContent = "-"
  memberList.appendChild(memberEmpty)
  const auditEmpty = document.createElement("div")
  auditEmpty.className = "list-empty"
  auditEmpty.textContent = "-"
  auditList.appendChild(auditEmpty)
}

async function fetchMembersForServer(serverId) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit("list server members", { server_id: serverId }, (err, res) => {
      if (err) {
        reject(new Error("Server tidak merespons saat memuat member"))
        return
      }
      if (!res || !res.ok) {
        reject(new Error((res && res.error) || "Gagal memuat member"))
        return
      }
      resolve(res.members || [])
    })
  })
}

async function fetchAuditLogsForServer(serverId) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit("list audit logs", { server_id: serverId }, (err, res) => {
      if (err) {
        reject(new Error("Server tidak merespons saat memuat audit logs"))
        return
      }
      if (!res || !res.ok) {
        reject(new Error((res && res.error) || "Gagal memuat audit logs"))
        return
      }
      resolve(res.logs || [])
    })
  })
}

function updateChannelActionState() {
  const activeChannel = channelSelect.value
  const hasChannel = Boolean(activeChannel)
  const activeServer = getActiveServer()
  const hasServer = Boolean(activeServer)
  const canManageRoles = hasServer && hasServerPermission("member.role.set", activeServer)
  const canMuteMembers = hasServer && hasServerPermission("member.mute", activeServer)
  const canKickMembers = hasServer && hasServerPermission("member.kick", activeServer)
  const canRenameServer = hasServer && hasServerPermission("server.rename", activeServer)
  const canTransferOwner =
    hasServer &&
    hasServerPermission("server.owner.transfer", activeServer) &&
    isServerOwner(activeServer)
  const canCreateChannel = hasServer && hasServerPermission("channel.create", activeServer)
  const canRenameChannel = hasServer && hasServerPermission("channel.rename", activeServer)
  const canDeleteChannel = hasServer && hasServerPermission("channel.delete", activeServer)
  const canSetChannelPerm = hasServer && hasServerPermission("channel.permission.set", activeServer)
  const canGetInvite = hasServer && hasServerPermission("invite.get", activeServer)
  const canRegenInvite = hasServer && hasServerPermission("invite.regenerate", activeServer)
  const canLeaveActiveServer = hasServer && canLeaveServer(activeServer)

  setElementHidden(sectionChannels, !hasServer)
  setElementHidden(sectionMembers, !hasServer)
  setElementHidden(sectionAudit, !hasServer)
  setElementHidden(rowServerLeave, !hasServer)
  setElementHidden(rowTransferOwner, !hasServer || !canTransferOwner)
  setElementHidden(rowInviteActions, !hasServer || !canGetInvite)
  setElementHidden(invitePreview, !hasServer || !canGetInvite)
  setElementHidden(rowChannelCreate, !hasServer || !canCreateChannel)
  setElementHidden(rowChannelManage, !hasServer || (!canRenameChannel && !canDeleteChannel))
  setElementHidden(rowChannelPermView, !hasServer || !canSetChannelPerm)
  setElementHidden(rowChannelPermSend, !hasServer || !canSetChannelPerm)
  setElementHidden(rowMemberTarget, !hasServer || (!canManageRoles && !canMuteMembers && !canKickMembers))
  setElementHidden(rowMemberRoleMain, !hasServer || !canManageRoles)
  setElementHidden(rowMemberRoleDemote, !hasServer || !canManageRoles)
  setElementHidden(rowMemberKick, !hasServer || !canKickMembers)
  setElementHidden(rowMemberMuteConfig, !hasServer || !canMuteMembers)
  setElementHidden(rowMemberMute, !hasServer || !canMuteMembers)

  setSoftButtonHidden(renameServerBtn, !hasServer || !canRenameServer)
  setSoftButtonHidden(transferOwnerBtn, !hasServer || !canTransferOwner)
  setSoftButtonHidden(regenInviteBtn, !hasServer || !canRegenInvite)
  setSoftButtonHidden(createChannelBtn, !hasServer || !canCreateChannel)
  setSoftButtonHidden(renameChannelBtn, !hasServer || !canRenameChannel)
  setSoftButtonHidden(deleteChannelBtn, !hasServer || !canDeleteChannel)
  setSoftButtonHidden(promoteBtn, !hasServer || !canManageRoles)
  setSoftButtonHidden(modBtn, !hasServer || !canManageRoles)
  setSoftButtonHidden(demoteBtn, !hasServer || !canManageRoles)
  setSoftButtonHidden(kickBtn, !hasServer || !canKickMembers)
  setSoftButtonHidden(muteBtn, !hasServer || !canMuteMembers)
  setSoftButtonHidden(unmuteBtn, !hasServer || !canMuteMembers)

  createServerBtn.disabled = !socket.connected
  createChannelBtn.disabled = !socket.connected || !canCreateChannel
  renameChannelBtn.disabled =
    !socket.connected || !canRenameChannel || !hasChannel || activeChannel === "general"
  deleteChannelBtn.disabled =
    !socket.connected || !canDeleteChannel || !hasChannel || activeChannel === "general"
  joinInviteBtn.disabled = !socket.connected
  getInviteBtn.disabled = !socket.connected || !canGetInvite
  regenInviteBtn.disabled = !socket.connected || !canRegenInvite
  copyInviteBtn.disabled = !socket.connected || !canGetInvite || !inviteShareUrl
  renameServerBtn.disabled = !socket.connected || !canRenameServer
  leaveServerBtn.disabled = !socket.connected || !canLeaveActiveServer
  transferOwnerBtn.disabled = !socket.connected || !canTransferOwner
  ownerUsernameInput.disabled = !socket.connected || !canTransferOwner
  promoteBtn.disabled = !socket.connected || !canManageRoles
  modBtn.disabled = !socket.connected || !canManageRoles
  demoteBtn.disabled = !socket.connected || !canManageRoles
  kickBtn.disabled = !socket.connected || !canKickMembers
  muteBtn.disabled = !socket.connected || !canMuteMembers
  unmuteBtn.disabled = !socket.connected || !canMuteMembers
  savePermBtn.disabled = !socket.connected || !canSetChannelPerm || !hasChannel
  memberFilterInput.disabled = !hasServer
  auditFilterSelect.disabled = !hasServer
  auditSearchInput.disabled = !hasServer
  memberUsernameInput.disabled = !socket.connected || (!canManageRoles && !canMuteMembers && !canKickMembers)
  muteDurationSelect.disabled = !socket.connected || !canMuteMembers
  muteReasonInput.disabled = !socket.connected || !canMuteMembers
  refreshMuteButtonLabel()
  permMemberView.disabled = !socket.connected || !canSetChannelPerm
  permMemberSend.disabled = !socket.connected || !canSetChannelPerm
  const muteInfo = hasServer ? getCurrentUserMuteInfo() : { isMuted: false, mutedUntilTs: 0, muteReason: "" }
  if (muteInfo.isMuted) {
    const reasonText = muteInfo.muteReason ? ` (${muteInfo.muteReason})` : ""
    msgInput.disabled = true
    sendBtn.disabled = true
    msgInput.placeholder = `Muted ${formatMuteRemaining(muteInfo.mutedUntilTs)}${reasonText}`
  } else {
    msgInput.disabled = !socket.connected || !hasServer || !isSessionReady
    sendBtn.disabled = !socket.connected || !hasServer || !isSessionReady
    msgInput.placeholder = "message"
  }
  if (noServerHint) {
    noServerHint.hidden = hasServer
  }
}

function formatTime(isoString) {
  if (!isoString) return ""
  const raw = String(isoString).trim()
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  const normalized = sqliteUtcPattern.test(raw) ? `${raw.replace(" ", "T")}Z` : raw
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function renderMessage(data, options = {}) {
  const animate = options.animate !== false
  const div = document.createElement("div")
  div.className = "chat-line"
  const isSelfMessage = String(data && data.username) === String(username)
  if (isSelfMessage) {
    div.classList.add("is-self")
  }
  if (animate) {
    div.classList.add("is-new")
    if (isSelfMessage) {
      div.classList.add("is-self-pulse")
    }
  }
  const user = document.createElement("b")
  user.textContent = `${data.username}: `
  const text = document.createElement("span")
  text.textContent = data.message
  const time = document.createElement("small")
  const friendlyTime = formatTime(data.created_at)
  time.textContent = friendlyTime ? ` (${friendlyTime})` : ""

  div.appendChild(user)
  div.appendChild(text)
  div.appendChild(time)
  messages.appendChild(div)
  if (animate) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        div.classList.remove("is-new")
      })
    })
    if (isSelfMessage) {
      setTimeout(() => {
        div.classList.remove("is-self-pulse")
      }, 700)
    }
  }
}

function setServerOptions(servers) {
  serverSelect.innerHTML = ""
  servers.forEach((item) => {
    const option = document.createElement("option")
    option.value = String(item.id)
    const roleLabel = getRoleBadge(getServerRoleName(item))
    option.textContent = `${item.name} • ${roleLabel}`
    serverSelect.appendChild(option)
  })
}

function getActiveServer() {
  const selected = Number(serverSelect.value)
  if (!Number.isInteger(selected) || selected <= 0) return null
  return serversCache.find((item) => item.id === selected) || null
}

function setChannelOptions(channels) {
  channelSelect.innerHTML = ""
  const sortedChannels = [...channels].sort((a, b) => {
    if (a.name === "general" && b.name !== "general") return -1
    if (a.name !== "general" && b.name === "general") return 1
    return a.name.localeCompare(b.name)
  })

  sortedChannels.forEach((item) => {
    const option = document.createElement("option")
    option.value = item.name
    option.textContent = `# ${item.name}`
    channelSelect.appendChild(option)
  })
  updateChannelActionState()
}

function applySelectionFromStorage() {
  const savedServerId = Number(localStorage.getItem(SERVER_KEY))
  const hasSavedServer = Number.isInteger(savedServerId) && savedServerId > 0
  const selectedServer =
    (hasSavedServer && serversCache.find((item) => item.id === savedServerId)) ||
    serversCache[0] ||
    null

  if (!selectedServer) {
    serverSelect.innerHTML = ""
    channelSelect.innerHTML = ""
    updateChannelActionState()
    return false
  }

  serverSelect.value = String(selectedServer.id)
  const channels = Array.isArray(selectedServer.channels) ? selectedServer.channels : []
  setChannelOptions(channels)

  const savedChannel = localStorage.getItem(CHANNEL_KEY)
  const channelExists = channels.some((item) => item.name === savedChannel)
  if (channelExists) {
    channelSelect.value = savedChannel
  } else if (channelSelect.options.length > 0) {
    channelSelect.selectedIndex = 0
  }

  localStorage.setItem(SERVER_KEY, String(selectedServer.id))
  if (channelSelect.value) {
    localStorage.setItem(CHANNEL_KEY, channelSelect.value)
  }
  updateChannelActionState()
  return true
}

function fetchServersWithTimeout() {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit("list servers", (err, res) => {
      if (err) {
        reject(new Error("Server tidak merespons saat memuat daftar server"))
        return
      }
      if (!res || !res.ok) {
        reject(new Error((res && res.error) || "Gagal memuat daftar server"))
        return
      }
      resolve(res.servers || [])
    })
  })
}

function setUsernameWithTimeout(nextUsername) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit("set username", nextUsername, (err, res) => {
      if (err) {
        reject(new Error("Server tidak merespons saat set username"))
        return
      }
      if (!res || !res.ok) {
        reject(new Error((res && res.error) || "Gagal set username"))
        return
      }
      resolve(res)
    })
  })
}

function joinServerChannelWithTimeout(serverId, channelName) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit(
      "join server channel",
      { server_id: serverId, channel: channelName },
      (err, res) => {
        if (err) {
          reject(new Error("Server tidak merespons saat join channel"))
          return
        }
        if (!res || !res.ok) {
          reject(new Error((res && res.error) || "Gagal join channel"))
          return
        }
        resolve(res)
      }
    )
  })
}

function getChannelPermissionWithTimeout(serverId, channelName) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit(
      "get channel permission",
      { server_id: serverId, channel: channelName, role: "member" },
      (err, res) => {
        if (err) {
          reject(new Error("Server tidak merespons saat ambil permission channel"))
          return
        }
        if (!res || !res.ok) {
          reject(new Error((res && res.error) || "Gagal ambil permission channel"))
          return
        }
        resolve(res)
      }
    )
  })
}

async function loadChannelPermission(serverId, channelName) {
  try {
    const permission = await getChannelPermissionWithTimeout(serverId, channelName)
    permMemberView.checked = Boolean(permission.can_view)
    permMemberSend.checked = Boolean(permission.can_send)
  } catch {
    permMemberView.checked = true
    permMemberSend.checked = true
  }
}

async function startSessionForSelectedChannel(showAlertOnFailure = true, onReady) {
  const requestId = ++sessionRequestId
  const nextUsername = usernameInput.value.trim()
  resetTypingState({ notifyServer: true })
  setInvitePreview("")
  setStatus("Joining channel...", false)

  if (!socket.connected) {
    isSessionReady = false
    setStatus("Disconnected", false)
    if (showAlertOnFailure) {
      notify("Server chat belum terhubung. Jalankan server lalu refresh.")
    }
    return
  }

  if (!nextUsername) {
    isSessionReady = false
    setStatus("Username required", false)
    if (showAlertOnFailure) {
      notify("Masukkan username dulu")
    }
    return
  }

  try {
    const userResult = await setUsernameWithTimeout(nextUsername)
    if (requestId !== sessionRequestId) return

    username = userResult.username
    currentUserId = Number(userResult.user_id) || null
    localStorage.setItem(USERNAME_KEY, username)

    serversCache = await fetchServersWithTimeout()
    if (requestId !== sessionRequestId) return

    setServerOptions(serversCache)
    const hasSelection = applySelectionFromStorage()
    if (!hasSelection) {
      isSessionReady = false
      setStatus("Belum join server • masuk pakai invite code", false)
      renderNoServerEmptyState()
      updateChannelActionState()
      if (pendingInviteCodeFromUrl && !inviteAutoJoinAttempted) {
        inviteAutoJoinAttempted = true
        inviteCodeInput.value = pendingInviteCodeFromUrl
        setTimeout(() => {
          if (socket.connected) {
            handleJoinInvite()
          }
        }, 0)
      }
      return
    }

    const activeServer = getActiveServer()
    const activeChannel = channelSelect.value
    if (!activeServer || !activeChannel) {
      isSessionReady = false
      setStatus("No channel available", false)
      messages.innerHTML = ""
      updateChannelActionState()
      return
    }

    const joinResult = await joinServerChannelWithTimeout(activeServer.id, activeChannel)
    if (requestId !== sessionRequestId) return

    await loadChannelPermission(activeServer.id, activeChannel)
    if (requestId !== sessionRequestId) return

    try {
      const members = await fetchMembersForServer(activeServer.id)
      if (requestId !== sessionRequestId) return
      setMembers(members)
    } catch {
      setMembers([])
    }

    try {
      const logs = await fetchAuditLogsForServer(activeServer.id)
      if (requestId !== sessionRequestId) return
      setAuditLogs(logs)
    } catch {
      setAuditLogs([])
    }

    messages.innerHTML = ""
    const historyMessages = Array.isArray(joinResult.history) ? joinResult.history : []
    historyMessages.forEach((row) => {
      renderMessage(row, { animate: false })
    })
    messages.scrollTop = messages.scrollHeight

    isSessionReady = true
    localStorage.setItem(SERVER_KEY, String(activeServer.id))
    localStorage.setItem(CHANNEL_KEY, activeChannel)
    setStatus(buildConnectedStatus(activeServer, activeChannel), true)
    updateChannelActionState()
    msgInput.focus()

    if (typeof onReady === "function") {
      onReady()
    }
  } catch (error) {
    if (requestId !== sessionRequestId) return
    isSessionReady = false
    setStatus("Join failed", false)
    if (showAlertOnFailure) {
      notify(error.message || "Gagal join channel")
    }
    clearRolePanels()
    permMemberView.checked = true
    permMemberSend.checked = true
    updateChannelActionState()
  }
}

async function handleCreateChannel() {
  const activeServer = getActiveServer()
  const channelName = channelNameInput.value.trim().toLowerCase()
  if (!activeServer) {
    notify("Server belum tersedia")
    return
  }
  if (!channelName) {
    notify("Masukkan nama channel dulu")
    return
  }
  if (!CHANNEL_NAME_PATTERN.test(channelName)) {
    notify("Nama channel hanya boleh huruf kecil, angka, dan '-'")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Creating channel...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "create channel",
        { server_id: activeServer.id, name: channelName },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat create channel"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal membuat channel"))
            return
          }
          resolve(res)
        }
      )
    })

    if (result && result.channel && result.channel.name) {
      localStorage.setItem(CHANNEL_KEY, result.channel.name)
    }
    channelNameInput.value = ""
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Create channel failed", false)
    notify(error.message || "Gagal membuat channel")
  }
}

async function handleDeleteChannel() {
  const activeServer = getActiveServer()
  const activeChannel = channelSelect.value

  if (!activeServer) {
    notify("Server belum tersedia")
    return
  }
  if (!activeChannel) {
    notify("Pilih channel dulu")
    return
  }
  if (activeChannel === "general") {
    notify("Channel #general tidak bisa dihapus")
    return
  }

  const confirmed = await confirmNotice(`Hapus channel #${activeChannel}?`, {
    title: "Delete Channel",
    type: "error",
    confirmLabel: "Delete",
    cancelLabel: "Cancel"
  })
  if (!confirmed) return

  try {
    setStatus("Deleting channel...", false)
    await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "delete channel",
        { server_id: activeServer.id, channel: activeChannel },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat delete channel"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal menghapus channel"))
            return
          }
          resolve(res)
        }
      )
    })

    localStorage.setItem(CHANNEL_KEY, "general")
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Delete channel failed", false)
    notify(error.message || "Gagal menghapus channel")
  }
}

async function handleJoinInvite() {
  const code = extractInviteCode(inviteCodeInput.value)
  if (!code) {
    notify("Masukkan invite code dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Joining via invite...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2000).emit("join via invite", { code }, (err, res) => {
        if (err) {
          reject(new Error("Server tidak merespons saat join invite"))
          return
        }
        if (!res || !res.ok) {
          reject(new Error((res && res.error) || "Gagal join via invite"))
          return
        }
        resolve(res)
      })
    })

    inviteCodeInput.value = ""
    pendingInviteCodeFromUrl = ""
    try {
      const cleanUrl = `${window.location.origin}${window.location.pathname}`
      window.history.replaceState({}, document.title, cleanUrl)
    } catch {}
    if (result && result.server_id) {
      localStorage.setItem(SERVER_KEY, String(result.server_id))
      localStorage.setItem(CHANNEL_KEY, "general")
    }
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Join invite failed", false)
    notify(error.message || "Gagal join via invite")
  }
}

async function handleCreateServer() {
  const newServerName = serverNameInput.value.trim()
  if (!newServerName) {
    notify("Masukkan nama server dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Creating server...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2000).emit("create server", { name: newServerName }, (err, res) => {
        if (err) {
          reject(new Error("Server tidak merespons saat create server"))
          return
        }
        if (!res || !res.ok) {
          reject(new Error((res && res.error) || "Gagal membuat server"))
          return
        }
        resolve(res)
      })
    })

    serverNameInput.value = ""
    if (result && result.server_id) {
      localStorage.setItem(SERVER_KEY, String(result.server_id))
      localStorage.setItem(CHANNEL_KEY, "general")
    }
    await startSessionForSelectedChannel(false)
    if (result && result.invite_code) {
      setInvitePreview(String(result.invite_code))
      updateChannelActionState()
    }
    notify("Server berhasil dibuat", "success")
  } catch (error) {
    setStatus("Create server failed", false)
    notify(error.message || "Gagal membuat server", "error")
  }
}

async function handleGetInvite() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Fetching invite...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "get server invite",
        { server_id: activeServer.id },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat ambil invite"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal ambil invite"))
            return
          }
          resolve(res)
        }
      )
    })

    const code = result && result.code ? String(result.code) : ""
    setInvitePreview(code)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    updateChannelActionState()
  } catch (error) {
    setStatus("Get invite failed", false)
    notify(error.message || "Gagal ambil invite")
  }
}

async function handleRegenInvite() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Regenerating invite...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "regenerate server invite",
        { server_id: activeServer.id },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat regenerate invite"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal regenerate invite"))
            return
          }
          resolve(res)
        }
      )
    })

    const code = result && result.code ? String(result.code) : ""
    setInvitePreview(code)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    updateChannelActionState()
    notify("Invite code berhasil di-regenerate", "success")
  } catch (error) {
    setStatus("Regenerate invite failed", false)
    notify(error.message || "Gagal regenerate invite", "error")
  }
}

async function handleRenameServer() {
  const activeServer = getActiveServer()
  const newServerName = serverNameInput.value.trim()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!newServerName) {
    notify("Masukkan nama server baru dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Renaming server...", false)
    await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "rename server",
        { server_id: activeServer.id, name: newServerName },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat rename server"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal rename server"))
            return
          }
          resolve(res)
        }
      )
    })

    const target = serversCache.find((item) => item.id === activeServer.id)
    if (target) {
      target.name = newServerName
    }
    setServerOptions(serversCache)
    serverSelect.value = String(activeServer.id)
    serverNameInput.value = ""

    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    notify("Server berhasil di-rename", "success")
  } catch (error) {
    setStatus("Rename server failed", false)
    notify(error.message || "Gagal rename server", "error")
  }
}

async function handleTransferOwner() {
  const activeServer = getActiveServer()
  const targetUsername = ownerUsernameInput.value.trim()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!targetUsername) {
    notify("Masukkan username owner baru dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const confirmed = await confirmNotice(
    `Transfer owner server "${activeServer.name}" ke "${targetUsername}"?`,
    {
      title: "Transfer Owner",
      type: "error",
      confirmLabel: "Transfer",
      cancelLabel: "Cancel"
    }
  )
  if (!confirmed) return

  try {
    setStatus("Transferring owner...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2500).emit(
        "transfer server owner",
        { server_id: activeServer.id, username: targetUsername },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat transfer owner"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal transfer owner"))
            return
          }
          resolve(res)
        }
      )
    })

    ownerUsernameInput.value = ""
    if (result && result.new_owner_user_id) {
      activeServer.owner_user_id = Number(result.new_owner_user_id)
    }

    const members = await fetchMembersForServer(activeServer.id)
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    updateChannelActionState()
    notify("Owner server berhasil dipindahkan", "success")
  } catch (error) {
    setStatus("Transfer owner failed", false)
    notify(error.message || "Gagal transfer owner server", "error")
  }
}

async function handleLeaveServer() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const confirmed = await confirmNotice(`Keluar dari server "${activeServer.name}"?`, {
    title: "Leave Server",
    type: "error",
    confirmLabel: "Leave",
    cancelLabel: "Cancel"
  })
  if (!confirmed) return

  try {
    setStatus("Leaving server...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "leave server",
        { server_id: activeServer.id },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat leave server"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal leave server"))
            return
          }
          resolve(res)
        }
      )
    })

    setInvitePreview("")
    serverNameInput.value = ""
    ownerUsernameInput.value = ""
    channelNameInput.value = ""
    memberUsernameInput.value = ""
    serversCache = serversCache.filter((item) => item.id !== activeServer.id)

    if (result && result.next_server_id) {
      localStorage.setItem(SERVER_KEY, String(result.next_server_id))
      localStorage.setItem(CHANNEL_KEY, "general")
    } else {
      localStorage.removeItem(SERVER_KEY)
      localStorage.removeItem(CHANNEL_KEY)
    }

    await startSessionForSelectedChannel(false)
    notify("Berhasil keluar dari server", "success")
  } catch (error) {
    setStatus("Leave server failed", false)
    notify(error.message || "Gagal leave server", "error")
  }
}

async function handleRenameChannel() {
  const activeServer = getActiveServer()
  const oldChannel = channelSelect.value
  const newChannel = channelNameInput.value.trim().toLowerCase()

  if (!activeServer) {
    notify("Server belum tersedia")
    return
  }
  if (!oldChannel) {
    notify("Pilih channel dulu")
    return
  }
  if (oldChannel === "general") {
    notify("Channel #general tidak bisa di-rename")
    return
  }
  if (!newChannel) {
    notify("Masukkan nama channel baru dulu")
    return
  }
  if (!CHANNEL_NAME_PATTERN.test(newChannel)) {
    notify("Nama channel hanya boleh huruf kecil, angka, dan '-'")
    return
  }
  if (newChannel === oldChannel) {
    notify("Nama channel baru harus berbeda")
    return
  }

  try {
    setStatus("Renaming channel...", false)
    await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "rename channel",
        { server_id: activeServer.id, old_channel: oldChannel, new_channel: newChannel },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat rename channel"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal rename channel"))
            return
          }
          resolve(res)
        }
      )
    })

    channelNameInput.value = ""
    localStorage.setItem(CHANNEL_KEY, newChannel)
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Rename channel failed", false)
    notify(error.message || "Gagal rename channel")
  }
}

async function handleSetMemberRole(role, targetOverride = "") {
  const activeServer = getActiveServer()
  const targetUsername = String(targetOverride || memberUsernameInput.value).trim()

  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!targetUsername) {
    notify("Masukkan username target dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Updating member role...", false)
    await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "set member role",
        { server_id: activeServer.id, username: targetUsername, role },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat update role"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal update role"))
            return
          }
          resolve(res)
        }
      )
    })

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    const members = await fetchMembersForServer(activeServer.id)
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
  } catch (error) {
    setStatus("Update role failed", false)
    notify(error.message || "Gagal update role")
  }
}

async function handleKickMember(targetOverride = "") {
  const activeServer = getActiveServer()
  const targetUsername = String(targetOverride || memberUsernameInput.value).trim()

  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!targetUsername) {
    notify("Masukkan username target dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const confirmed = await confirmNotice(`Kick "${targetUsername}" dari server "${activeServer.name}"?`, {
    title: "Kick Member",
    type: "error",
    confirmLabel: "Kick",
    cancelLabel: "Cancel"
  })
  if (!confirmed) return

  try {
    setStatus("Kicking member...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2500).emit(
        "kick member",
        { server_id: activeServer.id, username: targetUsername },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat kick member"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal kick member"))
            return
          }
          resolve(res)
        }
      )
    })

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    const members = await fetchMembersForServer(activeServer.id)
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    notify(`Member ${result.target_username || targetUsername} berhasil di-kick`, "success")
  } catch (error) {
    setStatus("Kick member failed", false)
    notify(error.message || "Gagal kick member", "error")
  }
}

function resolveMuteDuration(defaultMinutes = 10) {
  const fallback = Number.isInteger(defaultMinutes) && defaultMinutes > 0 ? defaultMinutes : 10
  const raw = String((muteDurationSelect && muteDurationSelect.value) || "").trim()
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10080) {
    return fallback
  }
  return parsed
}

function resolveMuteReason(reasonOverride = "") {
  if (typeof reasonOverride === "string" && reasonOverride.trim()) {
    return reasonOverride.trim()
  }
  return String((muteReasonInput && muteReasonInput.value) || "").trim()
}

async function handleMuteMember(targetOverride = "", defaultMinutes = 10, reasonOverride = "") {
  const activeServer = getActiveServer()
  const targetUsername = String(targetOverride || memberUsernameInput.value).trim()

  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!targetUsername) {
    notify("Masukkan username target dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const durationMinutes = resolveMuteDuration(defaultMinutes)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
    notify("Durasi mute harus 1-10080 menit")
    return
  }

  const muteReason = resolveMuteReason(reasonOverride)
  if (muteReason.length > 200) {
    notify("Alasan mute maksimal 200 karakter")
    return
  }

  try {
    setStatus("Muting member...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2500).emit(
        "mute member",
        {
          server_id: activeServer.id,
          username: targetUsername,
          duration_minutes: durationMinutes,
          reason: muteReason
        },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat mute member"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal mute member"))
            return
          }
          resolve(res)
        }
      )
    })

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    if (!targetOverride && muteReasonInput) {
      muteReasonInput.value = ""
    }
    const members = await fetchMembersForServer(activeServer.id)
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    notify(
      `Member ${result.target_username || targetUsername} berhasil di-mute ${durationMinutes} menit`,
      "success"
    )
  } catch (error) {
    setStatus("Mute member failed", false)
    notify(error.message || "Gagal mute member", "error")
  }
}

async function handleUnmuteMember(targetOverride = "") {
  const activeServer = getActiveServer()
  const targetUsername = String(targetOverride || memberUsernameInput.value).trim()

  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!targetUsername) {
    notify("Masukkan username target dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Unmuting member...", false)
    const result = await new Promise((resolve, reject) => {
      socket.timeout(2500).emit(
        "unmute member",
        { server_id: activeServer.id, username: targetUsername },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat unmute member"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal unmute member"))
            return
          }
          resolve(res)
        }
      )
    })

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    const members = await fetchMembersForServer(activeServer.id)
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    notify(`Mute ${result.target_username || targetUsername} berhasil dicabut`, "success")
  } catch (error) {
    setStatus("Unmute member failed", false)
    notify(error.message || "Gagal unmute member", "error")
  }
}

async function handleSaveChannelPermission() {
  const activeServer = getActiveServer()
  const activeChannel = channelSelect.value
  if (!activeServer || !activeChannel) {
    notify("Pilih server dan channel dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Saving channel permission...", false)
    await new Promise((resolve, reject) => {
      socket.timeout(2000).emit(
        "set channel permission",
        {
          server_id: activeServer.id,
          channel: activeChannel,
          role: "member",
          can_view: permMemberView.checked,
          can_send: permMemberSend.checked
        },
        (err, res) => {
          if (err) {
            reject(new Error("Server tidak merespons saat simpan permission"))
            return
          }
          if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Gagal simpan permission"))
            return
          }
          resolve(res)
        }
      )
    })

    setStatus(buildConnectedStatus(activeServer, activeChannel), true)
    notify("Permission channel berhasil disimpan", "success")
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
  } catch (error) {
    setStatus("Save permission failed", false)
    notify(error.message || "Gagal simpan permission", "error")
  }
}

function send() {
  if (!isSessionReady) {
    startSessionForSelectedChannel(true, send)
    return
  }

  const msg = msgInput.value.trim()
  if (!msg) return
  if (msg.length > MAX_MESSAGE_LENGTH) {
    notify(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter`)
    return
  }

  socket.emit("chat message", { message: msg })
  sendTypingState(false)
  stopTypingStateTimer()
  msgInput.value = ""
  msgInput.focus()
}

serverSelect.addEventListener("change", () => {
  const activeServer = getActiveServer()
  if (!activeServer) return

  localStorage.setItem(SERVER_KEY, String(activeServer.id))
  setInvitePreview("")
  setChannelOptions(activeServer.channels || [])
  if (channelSelect.value) {
    localStorage.setItem(CHANNEL_KEY, channelSelect.value)
  }
  resetTypingState({ notifyServer: true })
  messages.innerHTML = ""
  startSessionForSelectedChannel(true)
})

channelSelect.addEventListener("change", () => {
  localStorage.setItem(CHANNEL_KEY, channelSelect.value)
  resetTypingState({ notifyServer: true })
  messages.innerHTML = ""
  updateChannelActionState()
  startSessionForSelectedChannel(true)
})

createChannelBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleCreateChannel()
})

renameChannelBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleRenameChannel()
})

deleteChannelBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleDeleteChannel()
})

joinInviteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleJoinInvite()
})

getInviteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleGetInvite()
})

regenInviteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleRegenInvite()
})

renameServerBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleRenameServer()
})

createServerBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleCreateServer()
})

leaveServerBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleLeaveServer()
})

transferOwnerBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleTransferOwner()
})

promoteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleSetMemberRole("admin")
})

modBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleSetMemberRole("moderator")
})

demoteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleSetMemberRole("member")
})

kickBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleKickMember()
})

muteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleMuteMember()
})

unmuteBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleUnmuteMember()
})

copyInviteBtn.addEventListener("click", async (e) => {
  e.preventDefault()
  if (!inviteShareUrl) {
    notify("Ambil invite dulu")
    return
  }
  try {
    await navigator.clipboard.writeText(inviteShareUrl)
    notify("Invite link berhasil disalin", "success")
  } catch {
    notify("Gagal menyalin invite link", "error")
  }
})

savePermBtn.addEventListener("click", (e) => {
  e.preventDefault()
  handleSaveChannelPermission()
})

sendBtn.addEventListener("click", (e) => {
  e.preventDefault()
  send()
})

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    send()
  }
})

msgInput.addEventListener("input", () => {
  if (!isSessionReady) {
    resetTypingState()
    return
  }

  const hasText = msgInput.value.trim().length > 0
  if (!hasText) {
    sendTypingState(false)
    stopTypingStateTimer()
    return
  }

  sendTypingState(true)
  queueTypingStop()
})

msgInput.addEventListener("blur", () => {
  sendTypingState(false)
  stopTypingStateTimer()
})

channelNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    handleCreateChannel()
  }
})

inviteCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    handleJoinInvite()
  }
})

serverNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    const activeServer = getActiveServer()
    if (activeServer && hasServerPermission("server.rename", activeServer)) {
      handleRenameServer()
      return
    }
    handleCreateServer()
  }
})

ownerUsernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    handleTransferOwner()
  }
})

memberFilterInput.addEventListener("input", () => {
  renderMembers(getFilteredMembers())
})

auditFilterSelect.addEventListener("change", () => {
  renderAuditLogs(getFilteredAuditLogs())
})

auditSearchInput.addEventListener("input", () => {
  renderAuditLogs(getFilteredAuditLogs())
})

muteDurationSelect.addEventListener("change", () => {
  refreshMuteButtonLabel()
})

muteReasonInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    handleMuteMember()
  }
})

memberUsernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    const activeServer = getActiveServer()
    const canManageRoles = activeServer && hasServerPermission("member.role.set", activeServer)
    const canMuteMembers = activeServer && hasServerPermission("member.mute", activeServer)
    const canKickMembers = activeServer && hasServerPermission("member.kick", activeServer)
    if (canManageRoles) {
      handleSetMemberRole("admin")
      return
    }
    if (canMuteMembers) {
      handleMuteMember()
      return
    }
    if (canKickMembers) {
      handleKickMember()
    }
  }
})

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault()
    startSessionForSelectedChannel(true)
  }
})

if (noticeOk) {
  noticeOk.addEventListener("click", () => {
    closeNotice(true)
  })
}

if (noticeAction) {
  noticeAction.addEventListener("click", () => {
    const action = noticeActionHandler
    closeNotice(false)
    if (typeof action === "function") {
      action()
    }
  })
}

if (noticeBackdrop) {
  noticeBackdrop.addEventListener("click", (e) => {
    if (e.target === noticeBackdrop) {
      closeNotice(true)
    }
  })
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeNotice(true)
  }
})

socket.on("chat message", (data) => {
  if (!data || data.channel !== channelSelect.value) return
  if (data.username && data.username !== username) {
    typingUsers.delete(String(data.username))
    renderTypingIndicator()
  }
  renderMessage(data)
  messages.scrollTop = messages.scrollHeight
})

socket.on("typing indicator", (payload) => {
  if (!payload || !payload.username) return

  const activeServer = getActiveServer()
  const activeServerId = activeServer ? Number(activeServer.id) : 0
  const payloadServerId = Number(payload.server_id || 0)
  const payloadChannel = String(payload.channel || "")
  const activeChannel = String(channelSelect.value || "")
  const actor = String(payload.username)

  if (actor === username) return
  if (payloadServerId !== activeServerId) return
  if (payloadChannel !== activeChannel) return

  if (payload.is_typing) {
    typingUsers.add(actor)
  } else {
    typingUsers.delete(actor)
  }
  renderTypingIndicator()
})

socket.on("member mute state", (payload) => {
  if (!payload) return
  const serverId = Number(payload.server_id)
  if (!Number.isInteger(serverId) || serverId <= 0) return

  const activeServer = getActiveServer()
  const activeServerId = activeServer ? Number(activeServer.id) : 0
  const isMuted = Boolean(payload.is_muted)
  const reasonText = String(payload.mute_reason || "").trim()

  if (isMuted) {
    const remainingText = formatMuteRemaining(Number(payload.muted_until_ts || 0))
    const reasonSuffix = reasonText ? ` Alasan: ${reasonText}` : ""
    notify(`Kamu di-mute di server ini (${remainingText} lagi).${reasonSuffix}`, "error", {
      title: "Muted"
    })
    if (activeServerId === serverId) {
      sendTypingState(false)
      stopTypingStateTimer()
    }
  } else {
    notify("Mute kamu telah dicabut.", "success", { title: "Unmuted" })
  }

  if (activeServerId === serverId) {
    fetchMembersForServer(serverId)
      .then((members) => setMembers(members))
      .catch(() => {})
  }
})

socket.on("removed from server", (payload) => {
  if (!payload) return
  const serverId = Number(payload.server_id)
  if (!Number.isInteger(serverId) || serverId <= 0) return

  const removedServer = serversCache.find((item) => item.id === serverId)
  const removedServerName =
    String(payload.server_name || (removedServer && removedServer.name) || "server")

  serversCache = serversCache.filter((item) => item.id !== serverId)

  const selectedServerId = Number(serverSelect.value)
  const isSelectedServer = Number.isInteger(selectedServerId) && selectedServerId === serverId
  const storedServerId = Number(localStorage.getItem(SERVER_KEY))
  const wasStoredAsActive = Number.isInteger(storedServerId) && storedServerId === serverId

  setServerOptions(serversCache)
  if (!isSelectedServer && Number.isInteger(selectedServerId) && selectedServerId > 0) {
    const stillMember = serversCache.some((item) => item.id === selectedServerId)
    if (stillMember) {
      serverSelect.value = String(selectedServerId)
    }
  }

  if (wasStoredAsActive || isSelectedServer) {
    localStorage.removeItem(SERVER_KEY)
    localStorage.removeItem(CHANNEL_KEY)

    resetTypingState({ notifyServer: true })
    setInvitePreview("")
    messages.innerHTML = ""
    memberUsernameInput.value = ""
    notifyRemovedFromServer(removedServerName)
    startSessionForSelectedChannel(false)
    return
  }

  updateChannelActionState()
  notifyRemovedFromServer(removedServerName)
})

socket.on("system error", (payload) => {
  if (!payload || !payload.message) return
  notify(payload.message)
})

socket.on("channel renamed", (payload) => {
  if (!payload) return
  const serverId = Number(payload.server_id)
  const oldChannel = payload.old_channel
  const newChannel = payload.new_channel
  if (!serverId || !oldChannel || !newChannel) return

  const server = serversCache.find((item) => item.id === serverId)
  if (server && Array.isArray(server.channels)) {
    server.channels = server.channels.map((ch) =>
      ch.name === oldChannel ? { ...ch, name: newChannel } : ch
    )
  }

  const activeServer = getActiveServer()
  if (activeServer && activeServer.id === serverId) {
    const wasActive = channelSelect.value === oldChannel
    setChannelOptions(activeServer.channels || [])
    if (wasActive) {
      channelSelect.value = newChannel
      localStorage.setItem(CHANNEL_KEY, newChannel)
      startSessionForSelectedChannel(false)
    }
  }
})

socket.on("connect", () => {
  resetTypingState()
  setStatus("Connected", false)
  updateChannelActionState()
  startSessionForSelectedChannel(false)
})

socket.on("disconnect", () => {
  sessionRequestId += 1
  isSessionReady = false
  resetTypingState()
  setStatus("Disconnected", false)
  clearRolePanels()
  permMemberView.checked = true
  permMemberSend.checked = true
  updateChannelActionState()
})

socket.on("connect_error", () => {
  sessionRequestId += 1
  isSessionReady = false
  resetTypingState()
  setStatus("Connection error", false)
  clearRolePanels()
  permMemberView.checked = true
  permMemberSend.checked = true
  updateChannelActionState()
})

updateChannelActionState()
resetTypingState()
clearRolePanels()

