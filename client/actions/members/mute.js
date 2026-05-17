import { memberUsernameInput, muteReasonInput, channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { confirmNotice, notify, notifyError, setStatus } from "../../notice.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchMembersForServer, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer } from "../../session.js"
import { setMembers, resolveMuteDuration, resolveMuteReason } from "../../members.js"
import { setAuditLogs } from "../../audit.js"
import { formatDurationLabel } from "../../utils.js"

function parseMuteDurationInput(value) {
  const raw = String(value || "").trim().toLowerCase()
  const match = raw.match(/^(\d+)\s*(m|min|menit|h|hr|hour|jam|d|day|hari)?$/)
  if (!match) return null

  const amount = Number(match[1])
  const unit = match[2] || "m"
  const multiplier =
    unit === "h" || unit === "hr" || unit === "hour" || unit === "jam"
      ? 60
      : unit === "d" || unit === "day" || unit === "hari"
        ? 1440
        : 1
  const minutes = amount * multiplier
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 10080 ? minutes : null
}

function requestCustomMuteDuration() {
  const raw = window.prompt("Durasi mute? Contoh: 15m, 2h, 1d. Maks 7d.", "10m")
  if (raw === null) return null
  return parseMuteDurationInput(raw)
}

function resolveRequestedMuteDuration(targetOverride, defaultMinutes, manualDuration = null) {
  if (manualDuration !== null) return manualDuration
  if (!targetOverride) return resolveMuteDuration(defaultMinutes)
  const parsed = Number(defaultMinutes)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10080) {
    return resolveMuteDuration(10)
  }
  return parsed
}

async function handleMuteMember(targetOverride = "", defaultMinutes = 10, reasonOverride = "", options = {}) {
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

  const manualDuration = options && options.customDuration ? requestCustomMuteDuration() : null
  if (options && options.customDuration && manualDuration === null) {
    notify("Durasi mute tidak valid atau dibatalkan")
    return
  }

  const durationMinutes = resolveRequestedMuteDuration(targetOverride, defaultMinutes, manualDuration)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
    notify("Durasi mute harus 1-10080 menit")
    return
  }

  const muteReason = resolveMuteReason(reasonOverride)
  if (muteReason.length > 200) {
    notify("Alasan mute maksimal 200 karakter")
    return
  }

  const confirmed = await confirmNotice(
    `Mute "${targetUsername}" selama ${formatDurationLabel(durationMinutes)} di server "${activeServer.name}"?`,
    {
      title: "Mute Member",
      confirmLabel: "Mute",
      cancelLabel: "Batal",
      type: "error"
    }
  )
  if (!confirmed) return

  try {
    setStatus("Muting member...", false)
    const result = await emitWithTimeout(
      "mute member",
      {
        server_id: activeServer.id,
        username: targetUsername,
        duration_minutes: durationMinutes,
        reason: muteReason
      },
      {
        timeoutMs: 2500,
        timeoutMessage: "Server tidak merespons saat mute member",
        failMessage: "Gagal mute member"
      }
    )

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    if (!targetOverride && muteReasonInput) {
      muteReasonInput.value = ""
    }
    const members = await fetchMembersForServer(activeServer.id, { force: true })
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    notify(
      `Member ${result.target_username || targetUsername} berhasil di-mute ${formatDurationLabel(durationMinutes)}`,
      "success"
    )
  } catch (error) {
    setStatus("Mute member failed", false)
    notifyError(error, "Gagal mute member")
  }
}

export { handleMuteMember }
