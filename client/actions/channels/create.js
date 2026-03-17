import { channelNameInput } from "../../dom.js"
import { CHANNEL_NAME_PATTERN, CHANNEL_KEY } from "../../constants.js"
import { notify, setStatus } from "../../notice.js"
import { socket } from "../../socket.js"
import { emitWithTimeout } from "../../api.js"
import { getActiveServer, startSessionForSelectedChannel } from "../../session.js"

async function handleCreateChannel() {
  const activeServer = getActiveServer()
  const channelName = channelNameInput.value.trim().toLowerCase()
  if (!activeServer) {
    notify("Server belum tersedia")
    return
  }
  if (!channelName) {
    notify("Masukkan nama channel dulu")
    return
  }
  if (!CHANNEL_NAME_PATTERN.test(channelName)) {
    notify("Nama channel hanya boleh huruf kecil, angka, dan '-'")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Creating channel...", false)
    const result = await emitWithTimeout(
      "create channel",
      { server_id: activeServer.id, name: channelName },
      {
        timeoutMessage: "Server tidak merespons saat create channel",
        failMessage: "Gagal membuat channel"
      }
    )

    if (result && result.channel && result.channel.name) {
      localStorage.setItem(CHANNEL_KEY, result.channel.name)
    }
    channelNameInput.value = ""
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Create channel failed", false)
    notify(error.message || "Gagal membuat channel")
  }
}

export { handleCreateChannel }
