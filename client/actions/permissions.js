import { channelSelect, permMemberView, permMemberSend } from "../dom.js"
import { socket } from "../socket.js"
import { notify, setStatus } from "../notice.js"
import { buildConnectedStatus } from "../permissions.js"
import { emitWithTimeout, fetchAuditLogsForServer } from "../api.js"
import { getActiveServer } from "../session.js"
import { setAuditLogs } from "../audit.js"

async function handleSaveChannelPermission() {
  const activeServer = getActiveServer()
  const activeChannel = channelSelect.value
  if (!activeServer || !activeChannel) {
    notify("Pilih server dan channel dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Saving channel permission...", false)
    await emitWithTimeout(
      "set channel permission",
      {
        server_id: activeServer.id,
        channel: activeChannel,
        role: "member",
        can_view: permMemberView.checked,
        can_send: permMemberSend.checked
      },
      {
        timeoutMessage: "Server tidak merespons saat simpan permission",
        failMessage: "Gagal simpan permission"
      }
    )

    setStatus(buildConnectedStatus(activeServer, activeChannel), true)
    notify("Permission channel berhasil disimpan", "success")
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
  } catch (error) {
    setStatus("Save permission failed", false)
    notify(error.message || "Gagal simpan permission", "error")
  }
}

export { handleSaveChannelPermission }
