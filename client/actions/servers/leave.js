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

async function handleLeaveServer() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const confirmed = await confirmNotice(`Keluar dari server "${activeServer.name}"?`, {
    title: "Leave Server",
    type: "error",
    confirmLabel: "Leave",
    cancelLabel: "Cancel"
  })
  if (!confirmed) return

  try {
    setStatus("Leaving server...", false)
    const result = await emitWithTimeout(
      "leave server",
      { server_id: activeServer.id },
      {
        timeoutMessage: "Server tidak merespons saat leave server",
        failMessage: "Gagal leave server"
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
    notify("Berhasil keluar dari server", "success")
  } catch (error) {
    setStatus("Leave server failed", false)
    notify(error.message || "Gagal leave server", "error")
  }
}

export { handleLeaveServer }
