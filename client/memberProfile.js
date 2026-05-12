import {
  msgInput,
  memberProfilePopover,
  memberProfileCloseBtn,
  memberProfileAvatar,
  memberProfileName,
  memberProfileRole,
  memberProfilePresence,
  memberProfileJoined,
  memberProfileMentionBtn,
  memberProfileCopyBtn,
  memberProfileModerateBtn
} from "./dom.js"
import { notify } from "./notice.js"
import { DEFAULT_RICH_STATUS_KEY, RICH_STATUS_PRESETS } from "./constants.js"
import { getActiveServer } from "./session.js"

let activeProfile = null
let isBound = false

const RICH_STATUS_LABEL_MAP = RICH_STATUS_PRESETS.reduce((acc, item) => {
  const key = String(item && item.key || "").trim().toLowerCase()
  if (!key) return acc
  acc[key] = String(item && item.label || key)
  return acc
}, {})

function normalizeText(value) {
  return String(value || "").trim()
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase()
}

function getAvatarInitials(username) {
  const raw = normalizeText(username)
  if (!raw) return "?"
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase()
}

function getAvatarTone(username) {
  const palettes = [
    ["#5f8cff", "#79d7ff"],
    ["#5fd3a1", "#7ce9c4"],
    ["#f08cb9", "#ffbc8d"],
    ["#9b7cff", "#6fbfff"],
    ["#ff8b7d", "#ffd16f"],
    ["#58c7d5", "#8df2ff"]
  ]
  const seed = Array.from(normalizeText(username)).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palettes[seed % palettes.length]
}

function formatJoinedAt(isoString) {
  const raw = normalizeText(isoString)
  if (!raw) return "-"
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  const normalized = sqliteUtcPattern.test(raw) ? `${raw.replace(" ", "T")}Z` : raw
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  })
}

function resolveRoleLabel(roleName) {
  const roleKey = normalizeKey(roleName)
  if (roleKey === "admin") return "Admin"
  if (roleKey === "moderator") return "Moderator"
  return "Member"
}

function resolvePresenceText(profile = {}) {
  const isOnline = Boolean(profile && profile.is_online)
  if (!isOnline) return "Offline"
  const statusKey = normalizeKey(profile && profile.status_key) || DEFAULT_RICH_STATUS_KEY
  const statusLabel = RICH_STATUS_LABEL_MAP[statusKey] || RICH_STATUS_LABEL_MAP[DEFAULT_RICH_STATUS_KEY]
  const statusText = normalizeText(profile && profile.status_text)
  if (statusText) return `${statusLabel} • ${statusText}`
  return statusLabel || "Online"
}

function closeMemberProfilePopover() {
  if (!memberProfilePopover) return
  memberProfilePopover.classList.remove("show")
  memberProfilePopover.setAttribute("aria-hidden", "true")
  activeProfile = null
}

function appendMentionToComposer(username) {
  if (!msgInput) return
  const safeUsername = normalizeText(username)
  if (!safeUsername) return
  const mention = `@${safeUsername}`
  const current = normalizeText(msgInput.value)
  msgInput.value = current ? `${current} ${mention} ` : `${mention} `
  msgInput.focus()
}

async function copyToClipboard(value) {
  const text = normalizeText(value)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    notify("Username berhasil disalin", "success")
  } catch {
    try {
      const fallback = document.createElement("textarea")
      fallback.value = text
      fallback.setAttribute("readonly", "")
      fallback.style.position = "absolute"
      fallback.style.left = "-9999px"
      document.body.appendChild(fallback)
      fallback.select()
      document.execCommand("copy")
      fallback.remove()
      notify("Username berhasil disalin", "success")
    } catch {
      notify("Gagal menyalin username", "error")
    }
  }
}

function openMemberProfilePopover(profile) {
  if (!memberProfilePopover || !profile) return
  const username = normalizeText(profile.username)
  if (!username) return
  activeProfile = {
    username,
    role_name: normalizeText(profile.role_name) || "member",
    joined_at: normalizeText(profile.joined_at),
    is_online: Boolean(profile.is_online),
    status_key: normalizeText(profile.status_key),
    status_text: normalizeText(profile.status_text),
    is_self: Boolean(profile.is_self)
  }

  if (memberProfileAvatar) {
    const [toneA, toneB] = getAvatarTone(activeProfile.username)
    memberProfileAvatar.style.setProperty("--member-avatar-a", toneA)
    memberProfileAvatar.style.setProperty("--member-avatar-b", toneB)
    memberProfileAvatar.textContent = getAvatarInitials(activeProfile.username)
  }
  if (memberProfileName) {
    memberProfileName.textContent = activeProfile.username
  }
  if (memberProfileRole) {
    memberProfileRole.textContent = resolveRoleLabel(activeProfile.role_name)
  }
  if (memberProfilePresence) {
    memberProfilePresence.textContent = resolvePresenceText(activeProfile)
  }
  if (memberProfileJoined) {
    memberProfileJoined.textContent = `Joined ${formatJoinedAt(activeProfile.joined_at)}`
  }
  if (memberProfileModerateBtn) {
    const activeServer = getActiveServer()
    const currentRole = String(activeServer && activeServer.current_role_name || "").toLowerCase()
    const isAdmin = currentRole === "admin"
    memberProfileModerateBtn.hidden = activeProfile.is_self || !isAdmin
  }

  memberProfilePopover.classList.add("show")
  memberProfilePopover.setAttribute("aria-hidden", "false")
}

function bindProfileActions() {
  if (isBound) return
  isBound = true

  window.addEventListener("privix:member-profile-open", (event) => {
    const detail = event && event.detail
    if (!detail || typeof detail !== "object") return
    openMemberProfilePopover(detail)
  })

  window.addEventListener("privix:no-channel", () => {
    closeMemberProfilePopover()
  })

  if (memberProfileCloseBtn) {
    memberProfileCloseBtn.addEventListener("click", (event) => {
      event.preventDefault()
      closeMemberProfilePopover()
    })
  }

  if (memberProfilePopover) {
    memberProfilePopover.addEventListener("click", (event) => {
      if (event.target === memberProfilePopover) {
        closeMemberProfilePopover()
      }
    })
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMemberProfilePopover()
    }
  })

  if (memberProfileMentionBtn) {
    memberProfileMentionBtn.addEventListener("click", (event) => {
      event.preventDefault()
      if (!activeProfile) return
      appendMentionToComposer(activeProfile.username)
      closeMemberProfilePopover()
    })
  }

  if (memberProfileCopyBtn) {
    memberProfileCopyBtn.addEventListener("click", async (event) => {
      event.preventDefault()
      if (!activeProfile) return
      await copyToClipboard(activeProfile.username)
      closeMemberProfilePopover()
    })
  }

  if (memberProfileModerateBtn) {
    memberProfileModerateBtn.addEventListener("click", (event) => {
      event.preventDefault()
      if (!activeProfile) return
      window.dispatchEvent(
        new CustomEvent("privix:member-moderate-request", {
          detail: { username: activeProfile.username }
        })
      )
      closeMemberProfilePopover()
    })
  }
}

function initMemberProfilePopover() {
  bindProfileActions()
  closeMemberProfilePopover()
}

export { initMemberProfilePopover, closeMemberProfilePopover }
