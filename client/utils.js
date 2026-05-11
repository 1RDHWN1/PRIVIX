function parseTimestamp(isoString) {
  if (!isoString) return ""
  const raw = String(isoString).trim()
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  const normalized = sqliteUtcPattern.test(raw) ? `${raw.replace(" ", "T")}Z` : raw
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function formatTime(isoString) {
  const date = parseTimestamp(isoString)
  if (!date) return ""
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function getDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getChatDateKey(isoString) {
  const date = parseTimestamp(isoString)
  return date ? getDateKey(date) : ""
}

function formatChatDateLabel(isoString) {
  const date = parseTimestamp(isoString)
  if (!date) return ""

  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((today.getTime() - messageDay.getTime()) / 86400000)

  if (diffDays === 0) return "Hari ini"
  if (diffDays === 1) return "Kemarin"

  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  })
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

function buildInviteUrl(code) {
  if (!code) return ""
  const base = new URL(window.location.href)
  base.search = ""
  base.hash = ""
  return `${base.origin}${base.pathname}?invite=${encodeURIComponent(code)}`
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

function getAuditLogCategory(actionType) {
  const action = String(actionType || "").toLowerCase()
  if (action.startsWith("member_")) return "member"
  if (action.startsWith("channel_")) return "channel"
  if (action.startsWith("server_")) return "server"
  if (action.includes("invite")) return "invite"
  return "other"
}

export {
  formatTime,
  getChatDateKey,
  formatChatDateLabel,
  formatDurationLabel,
  formatMuteRemaining,
  appendHighlightedText,
  buildInviteUrl,
  extractInviteCode,
  getAuditLogCategory
}
