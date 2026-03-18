import { memberUsernameInput, channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus } from "../../notice.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchMembersForServer, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer } from "../../session.js"
import { setMembers } from "../../members.js"
import { setAuditLogs } from "../../audit.js"

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
    await emitWithTimeout(
      "set member role",
      { server_id: activeServer.id, username: targetUsername, role },
      {
        timeoutMessage: "Server tidak merespons saat update role",
        failMessage: "Gagal update role"
      }
    )

    memberUsernameInput.value = targetOverride ? targetUsername : ""
    const members = await fetchMembersForServer(activeServer.id, { force: true })
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
  } catch (error) {
    setStatus("Update role failed", false)
    notify(error.message || "Gagal update role")
  }
}

export { handleSetMemberRole }
