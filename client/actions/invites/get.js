import { channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus } from "../../notice.js"
import { setInvitePreview } from "../../ui.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout } from "../../api.js"
import { getActiveServer, updateChannelActionState } from "../../session.js"

async function handleGetInvite() {
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
    setStatus("Fetching invite...", false)
    const result = await emitWithTimeout(
      "get server invite",
      { server_id: activeServer.id },
      {
        timeoutMessage: "Server tidak merespons saat ambil invite",
        failMessage: "Gagal ambil invite"
      }
    )

    const code = result && result.code ? String(result.code) : ""
    setInvitePreview(code)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    updateChannelActionState()
  } catch (error) {
    setStatus("Get invite failed", false)
    notify(error.message || "Gagal ambil invite")
  }
}

export { handleGetInvite }
