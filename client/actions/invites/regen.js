import { channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus } from "../../notice.js"
import { setInvitePreview } from "../../ui.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer, updateChannelActionState } from "../../session.js"
import { setAuditLogs } from "../../audit.js"

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
    const result = await emitWithTimeout(
      "regenerate server invite",
      { server_id: activeServer.id },
      {
        timeoutMessage: "Server tidak merespons saat regenerate invite",
        failMessage: "Gagal regenerate invite"
      }
    )

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

export { handleRegenInvite }
