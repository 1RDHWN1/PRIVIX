import { auditList, auditFilterSelect, auditSearchInput } from "./dom.js"
import { state } from "./state.js"
import { formatTime, getAuditLogCategory } from "./utils.js"
import { renderListWithTransition } from "./ui.js"

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

function getFilteredAuditLogs() {
  const selectedCategory = String((auditFilterSelect && auditFilterSelect.value) || "all")
  const keyword = String((auditSearchInput && auditSearchInput.value) || "")
    .trim()
    .toLowerCase()

  return state.auditLogsCache.filter((row) => {
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
  state.auditLogsCache = Array.isArray(logs) ? logs : []
  renderAuditLogs(getFilteredAuditLogs())
}

export { renderAuditLogs, getFilteredAuditLogs, setAuditLogs }
