import {
  serverNameInput,
  ownerUsernameInput,
  channelNameInput,
  memberUsernameInput
} from "../../dom.js"
import { state } from "../../state.js"
import { socket } from "../../socket.js"
import { SERVER_KEY, CHANNEL_KEY } from "../../constants.js"
import { notify, setStatus, confirmNotice } from "../../notice.js"
import { setInvitePreview } from "../../ui.js"
import { emitWithTimeout } from "../../api.js"
import { getActiveServer, startSessionForSelectedChannel } from "../../session.js"

async function handleDeleteServer() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return false
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return false
  }

  const confirmed = await confirmNotice(
    `Hapus server "${activeServer.name}"? Semua channel, member, dan pesan di server ini akan ikut hilang.`,
    {
      title: "Delete Server",
      type: "error",
      confirmLabel: "Delete",
      cancelLabel: "Cancel"
    }
  )
  if (!confirmed) return false

  try {
    setStatus("Deleting server...", false)
    const result = await emitWithTimeout(
      "delete server",
      { server_id: activeServer.id },
      {
        timeoutMessage: "Server tidak merespons saat delete server",
        failMessage: "Gagal menghapus server"
      }
    )

    setInvitePreview("")
    serverNameInput.value = ""
    ownerUsernameInput.value = ""
    channelNameInput.value = ""
    memberUsernameInput.value = ""
    state.serversCache = state.serversCache.filter((item) => item.id !== activeServer.id)

    if (result && result.next_server_id) {
      localStorage.setItem(SERVER_KEY, String(result.next_server_id))
      localStorage.setItem(CHANNEL_KEY, "general")
    } else {
      localStorage.removeItem(SERVER_KEY)
      localStorage.removeItem(CHANNEL_KEY)
    }

    await startSessionForSelectedChannel(false)
    notify("Server berhasil dihapus", "success")
    return true
  } catch (error) {
    setStatus("Delete server failed", false)
    notify(error.message || "Gagal menghapus server", "error")
    return false
  }
}

export { handleDeleteServer }
