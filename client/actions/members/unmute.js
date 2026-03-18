import { memberUsernameInput, channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus } from "../../notice.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchMembersForServer, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer } from "../../session.js"
import { setMembers } from "../../members.js"
import { setAuditLogs } from "../../audit.js"

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
    const result = await emitWithTimeout(
      "unmute member",
      { server_id: activeServer.id, username: targetUsername },
      {
        timeoutMs: 2500,
        timeoutMessage: "Server tidak merespons saat unmute member",
        failMessage: "Gagal unmute member"
      }
    )

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    const members = await fetchMembersForServer(activeServer.id, { force: true })
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

export { handleUnmuteMember }
