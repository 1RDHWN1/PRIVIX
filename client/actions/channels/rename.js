import { channelNameInput, channelSelect } from "../../dom.js"
import { CHANNEL_NAME_PATTERN, CHANNEL_KEY } from "../../constants.js"
import { notify, setStatus } from "../../notice.js"
import { socket } from "../../socket.js"
import { emitWithTimeout } from "../../api.js"
import { getActiveServer, startSessionForSelectedChannel } from "../../session.js"

async function handleRenameChannel() {
  const activeServer = getActiveServer()
  const oldChannel = channelSelect.value
  const newChannel = channelNameInput.value.trim().toLowerCase()

  if (!activeServer) {
    notify("Server belum tersedia")
    return
  }
  if (!oldChannel) {
    notify("Pilih channel dulu")
    return
  }
  if (oldChannel === "general") {
    notify("Channel #general tidak bisa di-rename")
    return
  }
  if (!newChannel) {
    notify("Masukkan nama channel baru dulu")
    return
  }
  if (!CHANNEL_NAME_PATTERN.test(newChannel)) {
    notify("Nama channel hanya boleh huruf kecil, angka, dan '-'")
    return
  }
  if (newChannel === oldChannel) {
    notify("Nama channel baru harus berbeda")
    return
  }

  try {
    setStatus("Renaming channel...", false)
    await emitWithTimeout(
      "rename channel",
      { server_id: activeServer.id, old_channel: oldChannel, new_channel: newChannel },
      {
        timeoutMessage: "Server tidak merespons saat rename channel",
        failMessage: "Gagal rename channel"
      }
    )

    channelNameInput.value = ""
    localStorage.setItem(CHANNEL_KEY, newChannel)
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Rename channel failed", false)
    notify(error.message || "Gagal rename channel")
  }
}

export { handleRenameChannel }
