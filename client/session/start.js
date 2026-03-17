import {
  msgInput,
  usernameInput,
  inviteCodeInput,
  channelSelect,
  messages,
  permMemberView,
  permMemberSend
} from "../dom.js"
import { USERNAME_KEY, SERVER_KEY, CHANNEL_KEY } from "../constants.js"
import { state } from "../state.js"
import { setStatus, notify } from "../notice.js"
import {
  setInvitePreview,
  renderNoServerEmptyState,
  setServerOptions,
  renderMessage
} from "../ui.js"
import { buildConnectedStatus } from "../permissions.js"
import {
  fetchServersWithTimeout,
  setUsernameWithTimeout,
  joinServerChannelWithTimeout,
  getChannelPermissionWithTimeout,
  fetchMembersForServer,
  fetchAuditLogsForServer
} from "../api.js"
import { setMembers } from "../members.js"
import { setAuditLogs } from "../audit.js"
import { resetTypingState } from "../typing.js"
import { socket } from "../socket.js"
import {
  getActiveServer,
  applySelectionFromStorage,
  updateChannelActionState
} from "./selection.js"
import { clearRolePanels } from "./roles.js"

let autoJoinInviteHandler = null

function setAutoJoinInviteHandler(handler) {
  autoJoinInviteHandler = typeof handler === "function" ? handler : null
}

async function loadChannelPermission(serverId, channelName) {
  try {
    const permission = await getChannelPermissionWithTimeout(serverId, channelName)
    permMemberView.checked = Boolean(permission.can_view)
    permMemberSend.checked = Boolean(permission.can_send)
  } catch {
    permMemberView.checked = true
    permMemberSend.checked = true
  }
}

async function startSessionForSelectedChannel(showAlertOnFailure = true, onReady) {
  const requestId = ++state.sessionRequestId
  const nextUsername = usernameInput.value.trim()
  resetTypingState({ notifyServer: true })
  setInvitePreview("")
  setStatus("Joining channel...", false)

  if (!socket.connected) {
    state.isSessionReady = false
    setStatus("Disconnected", false)
    if (showAlertOnFailure) {
      notify("Server chat belum terhubung. Jalankan server lalu refresh.")
    }
    return
  }

  if (!nextUsername) {
    state.isSessionReady = false
    setStatus("Username required", false)
    if (showAlertOnFailure) {
      notify("Masukkan username dulu")
    }
    return
  }

  try {
    const userResult = await setUsernameWithTimeout(nextUsername)
    if (requestId !== state.sessionRequestId) return

    state.username = userResult.username
    state.currentUserId = Number(userResult.user_id) || null
    localStorage.setItem(USERNAME_KEY, state.username)

    state.serversCache = await fetchServersWithTimeout()
    if (requestId !== state.sessionRequestId) return

    setServerOptions(state.serversCache)
    const hasSelection = applySelectionFromStorage()
    if (!hasSelection) {
      state.isSessionReady = false
      setStatus("Belum join server • masuk pakai invite code", false)
      renderNoServerEmptyState()
      updateChannelActionState()
      if (state.pendingInviteCodeFromUrl && !state.inviteAutoJoinAttempted) {
        state.inviteAutoJoinAttempted = true
        inviteCodeInput.value = state.pendingInviteCodeFromUrl
        setTimeout(() => {
          if (socket.connected && typeof autoJoinInviteHandler === "function") {
            autoJoinInviteHandler()
          }
        }, 0)
      }
      return
    }

    const activeServer = getActiveServer()
    const activeChannel = channelSelect.value
    if (!activeServer || !activeChannel) {
      state.isSessionReady = false
      setStatus("No channel available", false)
      messages.innerHTML = ""
      updateChannelActionState()
      return
    }

    const joinResult = await joinServerChannelWithTimeout(activeServer.id, activeChannel)
    if (requestId !== state.sessionRequestId) return

    await loadChannelPermission(activeServer.id, activeChannel)
    if (requestId !== state.sessionRequestId) return

    try {
      const members = await fetchMembersForServer(activeServer.id)
      if (requestId !== state.sessionRequestId) return
      setMembers(members)
    } catch {
      setMembers([])
    }

    try {
      const logs = await fetchAuditLogsForServer(activeServer.id)
      if (requestId !== state.sessionRequestId) return
      setAuditLogs(logs)
    } catch {
      setAuditLogs([])
    }

    messages.innerHTML = ""
    const historyMessages = Array.isArray(joinResult.history) ? joinResult.history : []
    historyMessages.forEach((row) => {
      renderMessage(row, { animate: false })
    })
    messages.scrollTop = messages.scrollHeight

    state.isSessionReady = true
    localStorage.setItem(SERVER_KEY, String(activeServer.id))
    localStorage.setItem(CHANNEL_KEY, activeChannel)
    setStatus(buildConnectedStatus(activeServer, activeChannel), true)
    updateChannelActionState()
    msgInput.focus()

    if (typeof onReady === "function") {
      onReady()
    }
  } catch (error) {
    if (requestId !== state.sessionRequestId) return
    state.isSessionReady = false
    setStatus("Join failed", false)
    if (showAlertOnFailure) {
      notify(error.message || "Gagal join channel")
    }
    clearRolePanels()
    permMemberView.checked = true
    permMemberSend.checked = true
    updateChannelActionState()
  }
}

export { setAutoJoinInviteHandler, loadChannelPermission, startSessionForSelectedChannel }
