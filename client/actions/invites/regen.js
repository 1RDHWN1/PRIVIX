import { channelSelect } from "../../dom.js"
import { socket } from "../../socket.js"
import { confirmNotice, notify, notifyError, setStatus } from "../../notice.js"
import { setInvitePreview } from "../../ui.js"
import { buildConnectedStatus } from "../../permissions.js"
import { emitWithTimeout, fetchAuditLogsForServer } from "../../api.js"
import { getActiveServer, updateChannelActionState } from "../../session.js"
import { setAuditLogs } from "../../audit.js"

async function handleRegenInvite() {
  const activeServer = getActiveServer()
  if (!activeServer) {
    notify("Pilih server dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  const confirmed = await confirmNotice(
    `Regenerate invite untuk server "${activeServer.name}"? Link invite lama tidak bisa dipakai lagi.`,
    {
      title: "Regenerate Invite",
      confirmLabel: "Regenerate",
      cancelLabel: "Batal",
      type: "error"
    }
  )
  if (!confirmed) return

  try {
    setStatus("Regenerating invite...", false)
    const result = await emitWithTimeout(
      "regenerate server invite",
      { server_id: activeServer.id },
      {
        timeoutMessage: "Server tidak merespons saat regenerate invite",
        failMessage: "Gagal regenerate invite"
      }
    )

    const code = result && result.code ? String(result.code) : ""
    setInvitePreview(code)
    const logs = await fetchAuditLogsForServer(activeServer.id)
    setAuditLogs(logs)
    setStatus(buildConnectedStatus(activeServer, channelSelect.value), true)
    updateChannelActionState()
    notify("Invite code berhasil di-regenerate", "success")
  } catch (error) {
    setStatus("Regenerate invite failed", false)
    notifyError(error, "Gagal regenerate invite")
  }
}

export { handleRegenInvite }
