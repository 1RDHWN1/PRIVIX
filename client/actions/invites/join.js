import { inviteCodeInput } from "../../dom.js"
import { state } from "../../state.js"
import { socket } from "../../socket.js"
import { SERVER_KEY, CHANNEL_KEY } from "../../constants.js"
import { confirmNotice, notify, setStatus } from "../../notice.js"
import { extractInviteCode } from "../../utils.js"
import { emitWithTimeout } from "../../api.js"
import { startSessionForSelectedChannel } from "../../session.js"

async function previewInvite(code) {
  return emitWithTimeout(
    "preview invite",
    { code },
    {
      timeoutMessage: "Server tidak merespons saat memeriksa invite",
      failMessage: "Gagal memeriksa invite"
    }
  )
}

async function confirmJoinInvite(invite) {
  const serverName = String((invite && invite.server_name) || "server ini").trim()
  const alreadyMember = Boolean(invite && invite.already_member)
  const message = alreadyMember
    ? `Kamu sudah menjadi member "${serverName}". Buka server ini sekarang?`
    : `Kamu diundang untuk join server "${serverName}". Mau lanjut join?`

  return confirmNotice(message, {
    title: "Konfirmasi Invite",
    confirmLabel: alreadyMember ? "Buka Server" : "Join Server",
    cancelLabel: "Batal"
  })
}

async function handleJoinInvite() {
  const code = extractInviteCode(inviteCodeInput.value)
  if (!code) {
    notify("Masukkan invite code dulu")
    return
  }
  if (!socket.connected) {
    notify("Server belum terhubung")
    return
  }

  try {
    setStatus("Checking invite...", false)
    const invite = await previewInvite(code)
    const confirmed = await confirmJoinInvite(invite)
    if (!confirmed) {
      setStatus("Invite dibatalkan", false)
      return
    }

    setStatus("Joining via invite...", false)
    const result = await emitWithTimeout(
      "join via invite",
      { code },
      {
        timeoutMessage: "Server tidak merespons saat join invite",
        failMessage: "Gagal join via invite"
      }
    )

    inviteCodeInput.value = ""
    state.pendingInviteCodeFromUrl = ""
    try {
      const cleanUrl = `${window.location.origin}${window.location.pathname}`
      window.history.replaceState({}, document.title, cleanUrl)
    } catch {}
    if (result && result.server_id) {
      localStorage.setItem(SERVER_KEY, String(result.server_id))
      localStorage.setItem(CHANNEL_KEY, "general")
    }
    await startSessionForSelectedChannel(false)
  } catch (error) {
    setStatus("Join invite failed", false)
    notify(error.message || "Gagal join via invite")
  }
}

export { handleJoinInvite }
