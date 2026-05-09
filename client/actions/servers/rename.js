import { serverNameInput, serverSelect, channelSelect } from "../../dom.js"
import { state } from "../../state.js"
import { socket } from "../../socket.js"
import { notify, setStatus } from "../../notice.js"
import { setServerOptions } from "../../ui.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer } from "../../session.js"
import { setAuditLogs } from "../../audit.js"

async function handleRenameServer(nameOverride = "") {
  const activeServer = getActiveServer()
  const newServerName = String(nameOverride || serverNameInput.value || "").trim()
  if (!activeServer) {
    notify("Pilih server dulu")
    return false
  }
  if (!newServerName) {
    notify("Masukkan nama server baru dulu")
    return false
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return false
  }

  try {
    setStatus("Renaming server...", false)
    await emitWithTimeout(
      "rename server",
      { server_id: activeServer.id, name: newServerName },
      {
        timeoutMessage: "Server tidak merespons saat rename server",
        failMessage: "Gagal rename server"
      }
    )

    const target = state.serversCache.find((item) => item.id === activeServer.id)
    if (target) {
      target.name = newServerName
    }
    state.serversCache = [...state.serversCache]
    setServerOptions(state.serversCache)
    serverSelect.value = String(activeServer.id)
    serverNameInput.value = ""

    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    notify("Server berhasil di-rename", "success")
    return true
  } catch (error) {
    setStatus("Rename server failed", false)
    notify(error.message || "Gagal rename server", "error")
    return false
  }
}

export { handleRenameServer }
