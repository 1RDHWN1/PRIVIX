import { ownerUsernameInput, channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { notify, setStatus, confirmNotice } from "../../notice.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchMembersForServer, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer, updateChannelActionState } from "../../session.js"
import { setMembers } from "../../members.js"
import { setAuditLogs } from "../../audit.js"

async function handleTransferOwner() {
  const activeServer = getActiveServer()
  const targetUsername = ownerUsernameInput.value.trim()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!targetUsername) {
    notify("Masukkan username owner baru dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const confirmed = await confirmNotice(
    `Transfer owner server "${activeServer.name}" ke "${targetUsername}"?`,
    {
      title: "Transfer Owner",
      type: "error",
      confirmLabel: "Transfer",
      cancelLabel: "Cancel"
    }
  )
  if (!confirmed) return

  try {
    setStatus("Transferring owner...", false)
    const result = await emitWithTimeout(
      "transfer server owner",
      { server_id: activeServer.id, username: targetUsername },
      {
        timeoutMs: 2500,
        timeoutMessage: "Server tidak merespons saat transfer owner",
        failMessage: "Gagal transfer owner"
      }
    )

    ownerUsernameInput.value = ""
    if (result && result.new_owner_user_id) {
      activeServer.owner_user_id = Number(result.new_owner_user_id)
    }

    const members = await fetchMembersForServer(activeServer.id, { force: true })
    setMembers(members)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    updateChannelActionState()
    notify("Owner server berhasil dipindahkan", "success")
  } catch (error) {
    setStatus("Transfer owner failed", false)
    notify(error.message || "Gagal transfer owner server", "error")
  }
}

export { handleTransferOwner }
