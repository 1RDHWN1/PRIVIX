import { memberUsernameInput, channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus, confirmNotice } from "../../notice.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchMembersForServer, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer } from "../../session.js"
import { setMembers } from "../../members.js"
import { setAuditLogs } from "../../audit.js"

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
    const result = await emitWithTimeout(
      "kick member",
      { server_id: activeServer.id, username: targetUsername },
      {
        timeoutMs: 2500,
        timeoutMessage: "Server tidak merespons saat kick member",
        failMessage: "Gagal kick member"
      }
    )

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

export { handleKickMember }
