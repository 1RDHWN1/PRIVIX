import { memberUsernameInput, muteReasonInput, channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus } from "../../notice.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchMembersForServer, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer } from "../../session.js"
import { setMembers, resolveMuteDuration, resolveMuteReason } from "../../members.js"
import { setAuditLogs } from "../../audit.js"

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

export { handleMuteMember }
