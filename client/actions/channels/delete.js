import { channelSelect } from "../../dom.js"
import { CHANNEL_KEY } from "../../constants.js"
import { notify, setStatus, confirmNotice } from "../../notice.js"
import { socket } from "../../socket.js"
import { emitWithTimeout } from "../../api.js"
import { getActiveServer, startSessionForSelectedChannel } from "../../session.js"

async function handleDeleteChannel() {
  const activeServer = getActiveServer()
  const activeChannel = channelSelect.value

  if (!activeServer) {
    notify("Server belum tersedia")
    return
  }
  if (!activeChannel) {
    notify("Pilih channel dulu")
    return
  }
  if (activeChannel === "general") {
    notify("Channel #general tidak bisa dihapus")
    return
  }

  const confirmed = await confirmNotice(`Hapus channel #${activeChannel}?`, {
    title: "Delete Channel",
    type: "error",
    confirmLabel: "Delete",
    cancelLabel: "Cancel"
  })
  if (!confirmed) return

  try {
    setStatus("Deleting channel...", false)
    await emitWithTimeout(
      "delete channel",
      { server_id: activeServer.id, channel: activeChannel },
      {
        timeoutMessage: "Server tidak merespons saat delete channel",
        failMessage: "Gagal menghapus channel"
      }
    )

    localStorage.setItem(CHANNEL_KEY, "general")
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Delete channel failed", false)
    notify(error.message || "Gagal menghapus channel")
  }
}

export { handleDeleteChannel }
