import { channelNameInput, channelTypeSelect } from "../../dom.js"
import {
  CHANNEL_NAME_PATTERN,
  CHANNEL_KEY,
  CHANNEL_TYPES,
  CHANNEL_TYPE_TEXT
} from "../../constants.js"
import { notify, setStatus } from "../../notice.js"
import { socket } from "../../socket.js"
import { emitWithTimeout } from "../../api.js"
import { getActiveServer, startSessionForSelectedChannel } from "../../session.js"

async function handleCreateChannel() {
  const activeServer = getActiveServer()
  const channelName = channelNameInput.value.trim().toLowerCase()
  const channelType = String(channelTypeSelect && channelTypeSelect.value).trim().toLowerCase()
  const resolvedType = CHANNEL_TYPES.includes(channelType) ? channelType : CHANNEL_TYPE_TEXT
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
  if (!CHANNEL_TYPES.includes(resolvedType)) {
    notify("Tipe channel tidak valid")
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
      { server_id: activeServer.id, name: channelName, type: resolvedType },
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
