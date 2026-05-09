import { serverNameInput } from "../../dom.js"
import { socket } from "../../socket.js"
import { SERVER_KEY, CHANNEL_KEY } from "../../constants.js"
import { notify, setStatus } from "../../notice.js"
import { setInvitePreview } from "../../ui.js"
import { emitWithTimeout } from "../../api.js"
import { startSessionForSelectedChannel, updateChannelActionState } from "../../session.js"

async function handleCreateServer(nameOverride = "") {
  const newServerName = String(nameOverride || serverNameInput.value || "").trim()
  if (!newServerName) {
    notify("Masukkan nama server dulu")
    return false
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return false
  }

  try {
    setStatus("Creating server...", false)
    const result = await emitWithTimeout(
      "create server",
      { name: newServerName },
      {
        timeoutMessage: "Server tidak merespons saat create server",
        failMessage: "Gagal membuat server"
      }
    )

    serverNameInput.value = ""
    if (result && result.server_id) {
      localStorage.setItem(SERVER_KEY, String(result.server_id))
      localStorage.setItem(CHANNEL_KEY, "general")
    }
    await startSessionForSelectedChannel(false)
    if (result && result.invite_code) {
      setInvitePreview(String(result.invite_code))
      updateChannelActionState()
    }
    notify("Server berhasil dibuat", "success")
    return true
  } catch (error) {
    setStatus("Create server failed", false)
    notify(error.message || "Gagal membuat server", "error")
    return false
  }
}

export { handleCreateServer }
