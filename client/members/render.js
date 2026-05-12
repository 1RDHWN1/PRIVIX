import {
  activeChannelPresence,
  memberList,
  memberFilterInput,
  memberOnlineSummary,
  memberUsernameInput
} from "../dom.js"
import { state } from "../state.js"
import { appendHighlightedText, formatMuteRemaining } from "../utils.js"
import { hasServerPermission } from "../permissions.js"
import { renderListWithTransition } from "../ui.js"
import { resolveActiveServer, getMemberHandlers } from "./state.js"
import { getMutedUntilTs, isMemberMuted } from "./mute.js"

function getMemberInitials(username) {
  const raw = String(username || "").trim()
  if (!raw) return "?"
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return raw.slice(0, 2).toUpperCase()
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase()
}

function getMemberPalette(username) {
  const tones = [
    ["#5d89ff", "#72ddff"],
    ["#55c7b2", "#8ce7bc"],
    ["#ff8f9e", "#ffc284"],
    ["#7c6cff", "#6eaefc"],
    ["#ff9d63", "#ffd36e"]
  ]
  const seed = Array.from(String(username || "")).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return tones[seed % tones.length]
}

function buildMemberRow(item, options) {
  const {
    query,
    handlers,
    canManageRoles,
    canMuteMembers,
    canKickMembers
  } = options

  const usernameText = String((item && item.username) || "")
  const role = String((item && item.role_name) || "member").toLowerCase()
  const roleText =
    role === "admin" ? "admin" : role === "moderator" ? "moderator" : "member"
  const statusKey = String((item && item.presence_status_key) || "online").toLowerCase()
  const statusText = String((item && item.presence_status_text) || "").trim()
  const joinedAt = String((item && item.joined_at) || "").trim()
  const mutedUntilTs = getMutedUntilTs(item)
  const isMuted = isMemberMuted(item)
  const muteReason = String((item && item.mute_reason) || "").trim()
  const isSelf =
    usernameText &&
    state.username &&
    usernameText.toLowerCase() === String(state.username).toLowerCase()

  const line = document.createElement("div")
  line.className = "list-row member-item"
  line.classList.toggle("is-online", Boolean(item && item.is_online))
  line.classList.toggle("is-offline", !Boolean(item && item.is_online))

  const main = document.createElement("div")
  main.className = "member-main"

  const [toneA, toneB] = getMemberPalette(usernameText)
  const avatar = document.createElement("div")
  avatar.className = "member-avatar"
  avatar.style.setProperty("--member-avatar-a", toneA)
  avatar.style.setProperty("--member-avatar-b", toneB)
  avatar.textContent = getMemberInitials(usernameText)

  const identity = document.createElement("div")
  identity.className = "member-identity"

  const nameRow = document.createElement("div")
  nameRow.className = "member-name-row"

  const name = document.createElement("span")
  name.className = "member-name"
  appendHighlightedText(name, usernameText, query)
  nameRow.appendChild(name)

  if (isSelf) {
    const selfTag = document.createElement("span")
    selfTag.className = "member-role member-role-self"
    selfTag.textContent = "you"
    nameRow.appendChild(selfTag)
  }

  const meta = document.createElement("div")
  meta.className = "member-meta"

  const roleTag = document.createElement("span")
  roleTag.className = "member-role"
  roleTag.dataset.role = roleText
  appendHighlightedText(roleTag, roleText, query)
  meta.appendChild(roleTag)

  if (isMuted) {
    const muteTag = document.createElement("span")
    muteTag.className = "member-role"
    muteTag.dataset.role = "muted"
    muteTag.textContent = `muted ${formatMuteRemaining(mutedUntilTs)}`
    if (muteReason) {
      muteTag.title = `Reason: ${muteReason}`
    }
    meta.appendChild(muteTag)
  }

  identity.appendChild(nameRow)
  if (item && item.is_online && (statusText || statusKey !== "online")) {
    const presenceDetail = document.createElement("div")
    presenceDetail.className = "member-presence-detail"
    const statusLabel =
      statusKey === "coding"
        ? "Lagi ngoding"
        : statusKey === "afk"
        ? "AFK"
        : statusKey === "gaming"
        ? "Main game"
        : statusKey === "busy"
        ? "Busy"
        : "Online"
    presenceDetail.textContent = statusText ? `${statusLabel} • ${statusText}` : statusLabel
    identity.appendChild(presenceDetail)
  }
  identity.appendChild(meta)
  main.appendChild(avatar)
  main.appendChild(identity)
  line.appendChild(main)

  line.dataset.username = usernameText
  line.dataset.role = role
  line.dataset.isSelf = isSelf ? "true" : "false"
  line.dataset.isMuted = isMuted ? "true" : "false"
  line.dataset.canManageRoles = canManageRoles ? "true" : "false"
  line.dataset.canMuteMembers = canMuteMembers ? "true" : "false"
  line.dataset.canKickMembers = canKickMembers ? "true" : "false"
  line.dataset.joinedAt = joinedAt
  line.dataset.presenceStatusKey = statusKey
  line.dataset.presenceStatusText = statusText
  line.title = isSelf ? "Ini profil kamu" : "Klik untuk profil • klik kanan untuk moderasi"

  line.tabIndex = 0
  line.setAttribute("role", "group")
  line.setAttribute("aria-label", `Member ${usernameText}`)
  const pickMember = () => {
    memberUsernameInput.value = usernameText
    memberUsernameInput.focus()
  }
  const openProfile = () => {
    window.dispatchEvent(
      new CustomEvent("privix:member-profile-open", {
        detail: {
          username: usernameText,
          role_name: role,
          joined_at: joinedAt,
          is_online: Boolean(item && item.is_online),
          status_key: statusKey,
          status_text: statusText,
          is_self: isSelf
        }
      })
    )
  }
  line.addEventListener("click", () => {
    pickMember()
    openProfile()
  })
  line.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      pickMember()
      openProfile()
    }
  })
  return line
}

function renderMembers(members) {
  const activeServer = resolveActiveServer()
  const canManageRoles = activeServer && hasServerPermission("member.role.set", activeServer)
  const canMuteMembers = activeServer && hasServerPermission("member.mute", activeServer)
  const canKickMembers = activeServer && hasServerPermission("member.kick", activeServer)
  const query = String((memberFilterInput && memberFilterInput.value) || "")
    .trim()
    .toLowerCase()
  const handlers = getMemberHandlers()
  const totalMembers = Array.isArray(state.membersCache) ? state.membersCache.length : 0
  const totalOnline = Array.isArray(state.membersCache)
    ? state.membersCache.filter((item) => Boolean(item && item.is_online)).length
    : 0

  if (memberOnlineSummary) {
    memberOnlineSummary.textContent = `Online ${totalOnline}/${totalMembers}`
  }
  if (activeChannelPresence) {
    activeChannelPresence.textContent = `Online ${totalOnline}/${totalMembers}`
  }

  renderListWithTransition(memberList, (fragment) => {
    if (!Array.isArray(members) || members.length === 0) {
      const empty = document.createElement("div")
      empty.className = "list-empty"
      empty.textContent = query ? "Tidak ada member yang cocok" : "-"
      fragment.appendChild(empty)
      return
    }

    const onlineMembers = members.filter((item) => Boolean(item && item.is_online))
    const offlineMembers = members.filter((item) => !Boolean(item && item.is_online))

    const groups = [
      { key: "online", label: `Online — ${onlineMembers.length}`, items: onlineMembers },
      { key: "offline", label: `Offline — ${offlineMembers.length}`, items: offlineMembers }
    ]

    groups.forEach((group) => {
      if (!Array.isArray(group.items) || group.items.length === 0) return

      const groupSection = document.createElement("section")
      groupSection.className = "member-group"
      groupSection.dataset.group = group.key

      const groupTitle = document.createElement("div")
      groupTitle.className = "member-group-title"
      groupTitle.textContent = group.label

      const groupList = document.createElement("div")
      groupList.className = "member-group-list"

      group.items.forEach((item) => {
        groupList.appendChild(
          buildMemberRow(item, {
            query,
            handlers,
            canManageRoles,
            canMuteMembers,
            canKickMembers
          })
        )
      })

      groupSection.appendChild(groupTitle)
      groupSection.appendChild(groupList)
      fragment.appendChild(groupSection)
    })
  })
}

export { renderMembers }
